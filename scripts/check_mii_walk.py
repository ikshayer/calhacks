"""Run in background Blender against each assets/residents/*.blend authoring file.

Example: blender -b assets/residents/nia.blend --python-exit-code 1 --python scripts/check_mii_walk.py
Checks evaluated IK results, rather than the generator's intended control values.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mii_walk import action_curves, install_walk

arm = bpy.data.objects['Mii Armature']
scene = bpy.context.scene
walk = bpy.data.actions['walk']
curve_values = [[tuple(point.co) for point in curve.keyframe_points] for curve in action_curves(walk)]
assert install_walk(arm) is walk
assert curve_values == [[tuple(point.co) for point in curve.keyframe_points] for curve in action_curves(walk)]
assert tuple(walk.frame_range) == (0, 24) and scene.render.fps == 24
for name in ['torso m weights', 'torso f weights']:
    for modifier in bpy.data.objects[name].modifiers:
        if modifier.type == 'ARMATURE':
            assert not modifier.show_viewport and not modifier.show_render
for track in arm.animation_data.nla_tracks:
    track.mute = True
arm.animation_data.action = walk
arm.animation_data.action_slot = walk.slots[0]
stride = arm['walkStrideLength']
samples = []
for frame in range(25):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    samples.append({p.name: p.matrix.copy() for p in arm.pose.bones})
seam = max(abs(a - b) for name in samples[0]
           for row_a, row_b in zip(samples[0][name], samples[-1][name]) for a, b in zip(row_a, row_b))
root_drift = max(abs(a - b) for sample in samples for row_a, row_b in zip(sample['root'], samples[0]['root'])
                 for a, b in zip(row_a, row_b))
assert seam < 1e-5 and root_drift < 1e-6
contact = {}
for side, offset in [('L', 0), ('R', .5)]:
    segments = []
    for frame, sample in enumerate(samples):
        phase = (frame / 24 + offset) % 1
        if 0 <= phase <= .6:
            if not segments or frame != segments[-1][-1][0] + 1:
                segments.append([])
            point = sample['foot.' + side].translation - Vector((0, stride * frame / 24, 0))
            segments[-1].append((frame, point))
    drift = max((point - segment[0][1]).length for segment in segments for _, point in segment)
    lift = max(sample['foot.' + side].translation.z for sample in samples) - min(
        sample['foot.' + side].translation.z for sample in samples)
    assert drift < 2e-4 and lift > .025, (side, drift, lift)
    contact[side] = {'plantedDrift': drift, 'footClearance': lift}
joint_angles = [samples[i][name].to_quaternion().rotation_difference(samples[i+1][name].to_quaternion()).angle
                for name in ['calf.L', 'calf.R', 'hand.L', 'hand.R'] for i in range(24)]
max_joint_step = max(min(angle, math.tau - angle) for angle in joint_angles)
assert math.isfinite(max_joint_step) and max_joint_step < .5, max_joint_step
arm.animation_data.action = bpy.data.actions['Idle']
arm.animation_data.action_slot = arm.animation_data.action.slots[0]
scene.frame_set(0)
bpy.context.view_layer.update()
assert arm.pose.bones['COG'].location.length < 1e-6
print(json.dumps({'source': Path(bpy.data.filepath).name, 'seamError': seam, 'rootDrift': root_drift,
                  'contact': contact, 'maxJointStepRadians': max_joint_step, 'authoredWalkPreserved': True}, indent=2))
