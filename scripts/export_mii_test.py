"""Run in a separate Blender process against a COPY of Joey Carlino's source.

blender -b source.blend --disable-autoexec --python scripts/export_mii_test.py
Editable copies are refreshed under assets/residents before browser conversion.
The external downloaded source is never overwritten.
"""
import json
import argparse
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mii_resident_presets import PRESETS, apply_preset
from mii_walk import install_walk

parser = argparse.ArgumentParser()
parser.add_argument('--resident', choices=list(PRESETS))
parser.add_argument('--prepare-only', action='store_true')
parser.add_argument('--preserve-design', action='store_true', help='Keep the input editor choices and palette unchanged')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
resident_id = args.resident or 'resident'
OUT = ROOT / 'frontend/public/models/mii-test'
WORK = ROOT / '.tmp/mii-residents' / resident_id if args.resident else ROOT / '.tmp/mii-test'
OUT.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
source = bpy.data.objects['Mii Armature']
# Weight transfer must sample an undeformed donor. Otherwise the nearest-surface
# lookup assigns rest-pose arm vertices weights from an already bent arm.
for donor_name in ['torso m weights', 'torso f weights']:
    donor = bpy.data.objects.get(donor_name)
    if donor:
        for modifier in donor.modifiers:
            if modifier.type == 'ARMATURE':
                modifier.show_viewport = False
                modifier.show_render = False
if args.resident:
    if not args.preserve_design:
        preset = apply_preset(args.resident)
        (WORK / 'preset.json').write_text(json.dumps(preset, indent=2), encoding='utf-8')
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
install_walk(source)
authoring = ROOT / 'assets/residents' / (resident_id + '.blend')
authoring.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(authoring), copy=True, compress=True)
if args.prepare_only:
    print('Prepared ' + str(authoring), flush=True)
    sys.exit(0)
PARTS = ['body', 'head', 'hair', 'eye.L', 'eye.R', 'eyebrow.L',
         'eyebrow.R', 'nose', 'mouth', 'glasses', 'beard', 'mustache',
         'makeup', 'wrinkles', 'beauty mark']
report = {'source': 'https://joeycarlino.itch.io/mii-maker-for-blender',
          'resident': resident_id,
          'blender': bpy.app.version_string, 'parts': [], 'clips': [],
          'walk': {'strideLength': source['walkStrideLength'], 'cycleSeconds': source['walkCycleSeconds']},
          'limitations': ['Facial sprite selection is frozen at the test frame.',
                          'Asset reuse license is not specified on the listing.']}

# Freeze generated geometry independently of the control/picker collections.
for track in source.animation_data.nla_tracks:
    track.mute = True
source.animation_data.action = bpy.data.actions['Idle']
source.animation_data.action_slot = source.animation_data.action.slots[0]
scene.frame_set(0)
neutral_pose = {p.name: p.matrix_basis.copy() for p in source.pose.bones}
body = bpy.data.objects['body']
body.modifiers['Armature'].show_viewport = False
body.modifiers['Subdivision'].levels = 1
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
snapshots = []
for name in PARTS:
    obj = bpy.data.objects[name]
    ev = obj.evaluated_get(deps)
    mesh = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=deps)
    snapshots.append((name, mesh, ev.matrix_world.copy(),
                      [g.name for g in ev.vertex_groups], obj.parent_bone))
body.modifiers['Armature'].show_viewport = True
bpy.context.view_layer.update()

# Keep only the skeleton needed by the frozen character and its ancestors.
needed = set(snapshots[0][3])
needed.update(s[4] for s in snapshots if s[4])
for name in list(needed):
    bone = source.data.bones.get(name)
    while bone:
        needed.add(bone.name)
        bone = bone.parent
rig_data = bpy.data.armatures.new('MiiTestSkeleton')
rig = bpy.data.objects.new('MiiTest', rig_data)
rig['walkStrideLength'] = source['walkStrideLength']
rig['walkCycleSeconds'] = source['walkCycleSeconds']
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for b in source.data.bones:
    if b.name in needed:
        edit = rig_data.edit_bones.new(b.name)
        edit.head, edit.tail, edit.roll = b.head_local, b.tail_local, 0
        edit.matrix = b.matrix_local
        edit.length = b.length
for b in source.data.bones:
    if b.name in needed and b.parent and b.parent.name in needed:
        rig_data.edit_bones[b.name].parent = rig_data.edit_bones[b.parent.name]
bpy.ops.object.mode_set(mode='OBJECT')
rig.matrix_world = source.matrix_world.copy()
rest_pose = {b.name: source.pose.bones[b.name].matrix.copy() for b in rig_data.bones}
objects = []
for name, mesh, world, groups, parent_bone in snapshots:
    obj = bpy.data.objects.new('resident_' + name.replace('.', '_').replace(' ', '_'), mesh)
    scene.collection.objects.link(obj)
    if name == 'body':
        mesh.transform(source.matrix_world.inverted() @ world)
        for group in groups:
            obj.vertex_groups.new(name=group)
    else:
        # Undo the captured bone pose, leaving vertices in armature bind space.
        bone = source.data.bones[parent_bone]
        mesh.transform(bone.matrix_local @ rest_pose[parent_bone].inverted()
                       @ source.matrix_world.inverted() @ world)
        obj.vertex_groups.new(name=parent_bone).add(list(range(len(mesh.vertices))), 1, 'REPLACE')
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Identity(4)
    mod = obj.modifiers.new('Skin', 'ARMATURE')
    mod.object = rig
    objects.append(obj)

# Bake each used sprite rectangle into a small portable RGBA image. The original
# shader graph remains the source of truth for color and alpha, including masks.
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.cycles.device = 'CPU'
scene.render.bake.margin = 0
scene.render.image_settings.file_format = 'PNG'
for obj in list(bpy.context.selected_objects):
    obj.select_set(False)
plane_mesh = bpy.data.meshes.new('BakeQuad')
plane_mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)], [], [(0,1,2,3)])
plane = bpy.data.objects.new('BakeQuad', plane_mesh)
scene.collection.objects.link(plane)
source_uv = plane_mesh.uv_layers.new(name='SourceUV')
target_uv = plane_mesh.uv_layers.new(name='BakeUV')
source_uv.active_render = True
plane_mesh.uv_layers.active = target_uv
for loop, uv in zip(target_uv.data, [(0,0),(1,0),(1,1),(0,1)]):
    loop.uv = uv
plane.select_set(True)
bpy.context.view_layer.objects.active = plane
colors = bpy.data.node_groups['Color Control'].nodes['Group Output'].inputs


def constant(socket):
    if not socket.is_linked:
        return socket.default_value
    link = socket.links[0]
    if link.from_node.type == 'GROUP' and link.from_node.node_tree.name == 'Color Control':
        return colors[link.from_socket.name].default_value
    raise ValueError('Nonconstant input: ' + socket.name)


def bake_socket(mat, shader_socket, label):
    tree = mat.node_tree
    emit = tree.nodes.new('ShaderNodeEmission')
    if shader_socket.is_linked:
        tree.links.new(shader_socket.links[0].from_socket, emit.inputs['Color'])
    else:
        value = shader_socket.default_value
        emit.inputs['Color'].default_value = (value,value,value,1) if isinstance(value, (float,int)) else value
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    out.target = 'CYCLES'
    out.is_active_output = True
    tree.links.new(emit.outputs[0], out.inputs['Surface'])
    image = bpy.data.images.new(label, width=256, height=256, alpha=True, float_buffer=True)
    node = tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    tree.nodes.active = node
    bpy.ops.object.bake(type='EMIT', uv_layer='BakeUV', use_clear=True)
    pixels = np.empty(256*256*4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    tree.nodes.remove(node)
    tree.nodes.remove(out)
    tree.nodes.remove(emit)
    bpy.data.images.remove(image)
    return pixels.reshape((-1,4))


def portable_material(original, obj, slot):
    mat = bpy.data.materials.new(obj.name + '_' + str(slot))
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Roughness'].default_value = 0.8
    images = [n for n in original.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    loops = [i for poly in obj.data.polygons if poly.material_index == slot for i in poly.loop_indices]
    if not loops or original.name == 'none':
        return mat, True
    if not images:
        src = next((n for n in original.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if src is None:
            raise RuntimeError('Unsupported material: ' + original.name)
        bsdf.inputs['Base Color'].default_value = constant(src.inputs['Base Color'])
        return mat, False
    uv = obj.data.uv_layers.active
    coords = np.array([uv.data[i].uv[:] for i in loops])
    low, high = coords.min(axis=0), coords.max(axis=0)
    span = high - low
    if np.any(span < 1e-7):
        return mat, True
    for loop, pos in zip(source_uv.data, [(low[0],low[1]),(high[0],low[1]),
                                         (high[0],high[1]),(low[0],high[1])]):
        loop.uv = pos
    baking = original.copy()
    plane.data.materials.clear()
    plane.data.materials.append(baking)
    # Explicit UV source avoids accidentally sampling the target bake UVs.
    uv_node = baking.node_tree.nodes.new('ShaderNodeUVMap')
    uv_node.uv_map = 'SourceUV'
    for node in baking.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
            baking.node_tree.links.new(uv_node.outputs['UV'], node.inputs['Vector'])
    src = next((n for n in baking.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if src is None:
        # Expose the nested glasses shader's color/alpha for emission baking.
        group = next(n for n in baking.node_tree.nodes if n.type == 'GROUP' and n.node_tree.name == 'glasses color')
        group.node_tree = group.node_tree.copy()
        inner = group.node_tree
        inner_bsdf = next(n for n in inner.nodes if n.type == 'BSDF_PRINCIPLED')
        inner_out = next(n for n in inner.nodes if n.type == 'GROUP_OUTPUT')
        src = baking.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        for channel in ['Base Color', 'Alpha']:
            label = 'Export ' + channel
            inner.interface.new_socket(name=label, in_out='OUTPUT', socket_type='NodeSocketColor')
            socket = inner_bsdf.inputs[channel]
            if socket.is_linked:
                inner.links.new(socket.links[0].from_socket, inner_out.inputs[label])
            else:
                value = socket.default_value
                inner_out.inputs[label].default_value = (value,value,value,1) if isinstance(value,(float,int)) else value
            baking.node_tree.links.new(group.outputs[label], src.inputs[channel])
    rgb = bake_socket(baking, src.inputs['Base Color'], mat.name + '_color')
    alpha = bake_socket(baking, src.inputs['Alpha'], mat.name + '_alpha')[:,0]
    rgb[:,3] = np.clip(alpha,0,1)
    print('Sprite ' + mat.name + ' alpha range ' + str((float(alpha.min()),float(alpha.max()))), flush=True)
    invisible = bool(np.max(alpha) < 0.01)
    if not invisible:
        image = bpy.data.images.new(mat.name + '_rgba', width=256, height=256, alpha=True)
        image.pixels.foreach_set(rgb.ravel())
        image.filepath_raw = str(WORK / (mat.name + '.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.surface_render_method = 'DITHERED'
        mat.use_backface_culling = False
        for i in loops:
            uv.data[i].uv = (np.array(uv.data[i].uv) - low) / span
    bpy.data.materials.remove(baking)
    return mat, invisible


for obj in objects[:]:
    print('Preparing ' + obj.name, flush=True)
    hidden = []
    for slot, original in enumerate(list(obj.data.materials)):
        mat, invisible = portable_material(original, obj, slot)
        obj.data.materials[slot] = mat
        hidden.append(invisible)
    if hidden and all(hidden):
        objects.remove(obj)
        bpy.data.objects.remove(obj, do_unlink=True)
    else:
        obj.data.calc_loop_triangles()
        report['parts'].append({'name':obj.name,'vertices':len(obj.data.vertices),
                                'triangles':len(obj.data.loop_triangles)})
bpy.data.objects.remove(plane, do_unlink=True)

# Sample the constrained authoring rig into ordinary local bone keyframes.
for track in source.animation_data.nla_tracks:
    track.mute = True
for clip_name in ['Idle', 'look around', 'wave', 'walk']:
    action = bpy.data.actions.get(clip_name)
    if not action:
        continue
    # Keep the original clips' evaluation order and their unkeyed controls.
    # Walk starts independently so it cannot inherit the end of the wave.
    if clip_name in ['Idle', 'walk']:
        source.animation_data.action = None
        for name, matrix in neutral_pose.items():
            source.pose.bones[name].matrix_basis = matrix
    source.animation_data.action = action
    if action.slots:
        source.animation_data.action_slot = action.slots[0]
    rig.animation_data_create()
    baked = bpy.data.actions.new('test_' + clip_name.replace(' ','_'))
    rig.animation_data.action = baked
    start, end = (int(v) for v in action.frame_range)
    for frame in range(start, end+1):
        scene.frame_set(frame)
        for pb in rig.pose.bones:
            src = source.pose.bones[pb.name]
            parent_pose = source.pose.bones[pb.parent.name].matrix if pb.parent else Matrix.Identity(4)
            rest_local = pb.parent.bone.matrix_local.inverted() @ pb.bone.matrix_local if pb.parent else pb.bone.matrix_local
            pb.matrix_basis = rest_local.inverted() @ parent_pose.inverted() @ src.matrix
            pb.rotation_mode = 'QUATERNION'
            pb.keyframe_insert('location', frame=frame-start)
            pb.keyframe_insert('rotation_quaternion', frame=frame-start)
            pb.keyframe_insert('scale', frame=frame-start)
    slot = rig.animation_data.action_slot
    track = rig.animation_data.nla_tracks.new()
    track.name = baked.name
    strip = track.strips.new(baked.name, 0, baked)
    strip.action_slot = slot
    track.mute = True
    rig.animation_data.action = None
    report['clips'].append({'name':baked.name,'frames':end-start+1})
    print('Baked ' + baked.name, flush=True)

# Compare the exported body's deformation against the source at an idle frame.
source.animation_data.action = None
for name, matrix in neutral_pose.items():
    source.pose.bones[name].matrix_basis = matrix
source.animation_data.action = bpy.data.actions['Idle']
source.animation_data.action_slot = source.animation_data.action.slots[0]
rig.animation_data.action = bpy.data.actions['test_Idle']
rig.animation_data.action_slot = rig.animation_data.action.slots[0]
scene.frame_set(24)
deps = bpy.context.evaluated_depsgraph_get()
src_body = body.evaluated_get(deps)
dst_body = objects[0].evaluated_get(deps)
errors = []
for a, b in zip(src_body.data.vertices, dst_body.data.vertices):
    errors.append((src_body.matrix_world @ a.co - dst_body.matrix_world @ b.co).length)
report['deformation_check'] = {'vertices':len(errors),'max_error':max(errors),
                             'mean_error':sum(errors)/len(errors),
                             'source_preserve_volume':body.modifiers['Armature'].use_deform_preserve_volume}
print('Deformation comparison: '+json.dumps(report['deformation_check']),flush=True)
rig.animation_data.action = None
scene.frame_start = 0
scene.frame_end = 102
scene.frame_set(0)
# Only test clips may be considered for this export, never the source rig's
# incompatible control animations.
source.animation_data_clear()
for action in list(bpy.data.actions):
    if not action.name.startswith('test_'):
        bpy.data.actions.remove(action)
for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in [rig, *objects]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(OUT / (resident_id + '.glb')), export_format='GLB',
                          use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_frame_range=False,
                          export_force_sampling=True, export_skins=True,
                          export_extras=True,
                          export_yup=True, export_cameras=False, export_lights=False)
report['bones'] = len(rig.data.bones)
report['bytes'] = (OUT / (resident_id + '.glb')).stat().st_size
report['triangles'] = sum(p['triangles'] for p in report['parts'])
(OUT / ('report.json' if not args.resident else resident_id + '-report.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2), flush=True)
