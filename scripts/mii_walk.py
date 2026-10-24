"""Editable one-second, in-place walk for the original Mii editor's IK rig."""
import math
import re

import bpy
from mathutils import Matrix, Vector

CYCLE_FRAMES = 24
STRIDE_LENGTH = 0.44
STANCE = 0.6
FOOT_LIFT = 0.045


def foot_path(phase):
    """Backward stance at constant speed; C1-continuous, lifted return swing."""
    u = phase % 1.0
    half_travel = STRIDE_LENGTH * STANCE / 2
    if u <= STANCE:
        return -half_travel + STRIDE_LENGTH * u, 0.0
    s = (u - STANCE) / (1 - STANCE)
    tangent = STRIDE_LENGTH * (1 - STANCE)
    y = ((2*s**3 - 3*s**2 + 1) * half_travel +
         (s**3 - 2*s**2 + s) * tangent +
         (-2*s**3 + 3*s**2) * -half_travel +
         (s**3 - s**2) * tangent)
    return y, FOOT_LIFT * math.sin(math.pi * s)**2


def action_curves(action):
    return [curve for layer in action.layers for strip in layer.strips
            for bag in strip.channelbags for curve in bag.fcurves]


def neutral_cog_channels(arm, matrix):
    """Give older clips their original static COG when switching from walk.

    Blender otherwise retains an unkeyed control's last walk value. Existing
    animated COG channels are left intact; the walk's curves are never changed.
    """
    animation = arm.animation_data
    previous_action, previous_slot = animation.action, animation.action_slot
    cog = arm.pose.bones['COG']
    previous_matrix, previous_mode = cog.matrix_basis.copy(), cog.rotation_mode
    try:
        for name in ['Idle', 'look around', 'wave']:
            action = bpy.data.actions.get(name)
            if not action or any(c.data_path.startswith('pose.bones["COG"]') for c in action_curves(action)):
                continue
            animation.action = action
            animation.action_slot = action.slots[0]
            cog.rotation_mode = 'QUATERNION'
            cog.matrix_basis = matrix
            for channel in ['location', 'rotation_quaternion', 'scale']:
                cog.keyframe_insert(channel, frame=action.frame_range[0], group='COG')
    finally:
        animation.action = previous_action
        if previous_action:
            animation.action_slot = previous_slot
        cog.rotation_mode, cog.matrix_basis = previous_mode, previous_matrix


def install_walk(arm):
    """Preserve a previously authored walk; generate only when none exists.

    The neutral pose is sampled from Idle. Editor picker bones and colors are
    never keyed or reset. All changes to the active pose/action are restored.
    """
    existing = bpy.data.actions.get('walk')
    if existing:
        if existing.get('description', '').startswith('Compact Mii walk:'):
            values = existing.get('neutralCOG')
            neutral = Matrix([values[i:i+4] for i in range(0, 16, 4)]) if values else Matrix.Identity(4)
            neutral_cog_channels(arm, neutral)
        arm['walkStrideLength'] = existing.get('walkStrideLength', arm.get('walkStrideLength', STRIDE_LENGTH))
        arm['walkCycleSeconds'] = (existing.frame_range[1] - existing.frame_range[0]) / bpy.context.scene.render.fps
        return existing
    scene = bpy.context.scene
    idle = bpy.data.actions.get('Idle')
    if not idle:
        raise RuntimeError('The Mii editor Idle action is required to author the walk')
    arm.animation_data_create()
    animation = arm.animation_data
    previous_action, previous_slot = animation.action, animation.action_slot
    previous_frame = scene.frame_current
    previous_pose = {p.name: (p.matrix_basis.copy(), p.rotation_mode) for p in arm.pose.bones}
    previous_mutes = [(track, track.mute) for track in animation.nla_tracks]
    for track, _ in previous_mutes:
        track.mute = True
    try:
        scene.render.fps = 24
        animation.action = idle
        animation.action_slot = idle.slots[0]
        scene.frame_set(0)
        bpy.context.view_layer.update()
        names = {'root', 'COG', 'IK.foot.L', 'IK.foot.R'}
        for curve in action_curves(idle):
            match = re.match(r'pose\.bones\["([^"]+)"\]', curve.data_path)
            if match and match.group(1) != 'mark':
                names.add(match.group(1))
        baseline = {name: arm.pose.bones[name].matrix_basis.copy() for name in names}
        poses = {p.name: p.matrix.copy() for p in arm.pose.bones}
        action = bpy.data.actions.new('walk')
        action.use_fake_user = True
        action['walkStrideLength'] = STRIDE_LENGTH
        action['walkCycleSeconds'] = 1.0
        action['description'] = 'Compact Mii walk: stationary root, alternating IK stance and swing'
        action['neutralCOG'] = [value for row in baseline['COG'] for value in row]
        animation.action = action
        for frame in range(CYCLE_FRAMES + 1):
            scene.frame_set(frame)
            phase = (frame / CYCLE_FRAMES) % 1.0
            angle = math.tau * phase
            for name in names:
                pb = arm.pose.bones[name]
                pb.rotation_mode = 'QUATERNION'
                pb.matrix_basis = baseline[name]
            delta = Vector((0.004 * math.sin(angle), 0,
                            -0.018 + 0.009 * math.cos(2 * angle)))
            arm.pose.bones['COG'].matrix = (Matrix.Translation(delta) @ poses['COG'] @
                                           Matrix.Rotation(0.018 * math.sin(angle), 4, 'Z'))
            bpy.context.view_layer.update()
            # Head keeps its neutral facing direction while following the bob.
            arm.pose.bones['IK.spine'].matrix = Matrix.Translation(delta) @ poses['IK.spine']
            for side, offset, swing_sign in [('L', 0, 1), ('R', 0.5, -1)]:
                travel, lift = foot_path(phase + offset)
                target = poses['ctrl.foot.' + side].copy()
                target.translation.y += (poses['hip'].translation.y -
                                         poses['IK.foot.' + side].translation.y + travel)
                target.translation.z += lift
                # These controls are children of COG. Setting their desired
                # armature-space matrix compensates both body sway and bob.
                arm.pose.bones['ctrl.foot.' + side].matrix = target
                hand = poses['IK.hand.' + side].copy()
                hand.translation += delta + Vector((0, swing_sign * 0.06 * math.cos(angle),
                                                     0.006 * math.cos(angle)**2))
                arm.pose.bones['IK.hand.' + side].matrix = hand
            bpy.context.view_layer.update()
            for name in names:
                pb = arm.pose.bones[name]
                for channel in ['location', 'rotation_quaternion', 'scale']:
                    pb.keyframe_insert(channel, frame=frame, group=name)
        for curve in action_curves(action):
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
            curve.modifiers.new('CYCLES')
        arm['walkStrideLength'] = STRIDE_LENGTH
        arm['walkCycleSeconds'] = 1.0
        neutral_cog_channels(arm, baseline['COG'])
        return action
    finally:
        animation.action = previous_action
        if previous_action:
            animation.action_slot = previous_slot
        for track, muted in previous_mutes:
            track.mute = muted
        scene.frame_set(previous_frame)
        for name, (matrix, mode) in previous_pose.items():
            arm.pose.bones[name].rotation_mode = mode
            arm.pose.bones[name].matrix_basis = matrix
        bpy.context.view_layer.update()
