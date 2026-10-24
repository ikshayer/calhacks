"""Create a separate Blender comparison scene from the resident browser exports.

Run through Blender's Python console/MCP with this file's __file__ defined.
The original editor scene is retained; a copy is saved to assets/residents.
"""
from pathlib import Path
import json
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
scene = bpy.data.scenes.new('Resident walking lineup')
bpy.context.window.scene = scene
scene.frame_start, scene.frame_end = 0, 24
scene.render.fps = 24
scene.world = bpy.data.worlds.new('Resident studio')
scene.world.color = (.12, .15, .18)
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16

def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .8
    return mat

label_material = material('Resident labels', (.025, .04, .05))
catalog = json.loads((ROOT / 'frontend/src/dev/residentCatalog.json').read_text())
columns = 5
for index, spec in enumerate(catalog):
    resident_id, name = spec['id'], spec['name']
    x, y = (index % columns - 2) * 2.1, (index // columns - .5) * 4.8
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'frontend/public/models/mii-test' / (resident_id + '.glb')))
    imported = set(scene.objects) - before
    for obj in imported:
        if obj.type == 'MESH' and not obj.name.startswith('resident_'):
            # glTF import creates an Icosphere for bone widgets; it is not part
            # of the resident and must not affect framing or render output.
            obj.hide_render = True
            obj.hide_set(True)
    for obj in imported:
        if obj.type == 'ARMATURE' and obj.animation_data and obj.animation_data.action:
            # The importer enables the first (Idle) clip by default.
            for track in obj.animation_data.nla_tracks:
                track.mute = True
    scene.frame_set(0)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    points = [obj.evaluated_get(deps).matrix_world @ vertex.co
              for obj in imported if obj.type == 'MESH' and obj.name.startswith('resident_')
              for vertex in obj.evaluated_get(deps).data.vertices]
    low = Vector(tuple(min(p[a] for p in points) for a in range(3)))
    high = Vector(tuple(max(p[a] for p in points) for a in range(3)))
    center = (low + high) / 2
    scale = 2.4 / (high.z - low.z)
    group = bpy.data.objects.new(name + ' resident', None)
    scene.collection.objects.link(group)
    for obj in imported:
        if obj.parent not in imported:
            world = obj.matrix_world.copy()
            obj.parent = group
            obj.matrix_world = world
    group.scale = (scale,) * 3
    group.location = (x - center.x*scale, y - center.y*scale, -low.z*scale)
    for obj in imported:
        if obj.type == 'ARMATURE' and obj.animation_data:
            walk = next(strip for track in obj.animation_data.nla_tracks
                        for strip in track.strips if strip.action.name.startswith('test_walk'))
            obj.animation_data.action = walk.action
            obj.animation_data.action_slot = walk.action_slot
    curve = bpy.data.curves.new(name+' name','FONT')
    curve.body, curve.size, curve.align_x = name, .18, 'CENTER'
    text = bpy.data.objects.new(name+' name',curve)
    scene.collection.objects.link(text)
    text.location = (x, y - .7, .08)
    text.rotation_euler = (1.5707963268, 0, 0)
    text.data.materials.append(label_material)

bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.025))
bpy.context.object.name = 'Studio floor'
bpy.context.object.data.materials.append(material('Studio sand', (.44,.51,.52)))
camera = bpy.data.cameras.new('Resident lineup camera')
camera.type, camera.ortho_scale = 'ORTHO', 13.8
obj = bpy.data.objects.new('Resident lineup camera',camera)
scene.collection.objects.link(obj)
obj.location = (0,-13,10)
obj.rotation_euler = (Vector((0,0,1.2))-obj.location).to_track_quat('-Z','Y').to_euler()
scene.camera = obj
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.resolution_percentage = 100
for name, position, energy, size in [('Key',(-4,-6,8),900,7),('Fill',(5,-3,5),650,6)]:
    light = bpy.data.lights.new(name,'AREA')
    light.energy, light.shape, light.size = energy, 'DISK', size
    obj = bpy.data.objects.new(name,light)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
scene.frame_set(0)
for area in (bpy.context.screen.areas if bpy.context.screen else []):
    if area.type == 'VIEW_3D':
        area.spaces.active.use_local_camera = False
        area.spaces.active.camera = scene.camera
        area.spaces.active.show_region_ui = False
        area.spaces.active.show_gizmo = False
        area.spaces.active.region_3d.view_perspective = 'CAMERA'
        area.spaces.active.region_3d.view_camera_zoom = 25
        area.spaces.active.region_3d.view_camera_offset = (0,0)
        area.spaces.active.shading.type = 'MATERIAL'
        area.spaces.active.overlay.show_overlays = False
path = ROOT / 'assets/residents/lineup.blend'
path.parent.mkdir(parents=True, exist_ok=True)
# A background run has no viewport thumbnail; avoid writing a global cache.
previous_preview = bpy.context.preferences.filepaths.file_preview_type
if bpy.app.background:
    bpy.context.preferences.filepaths.file_preview_type = 'NONE'
bpy.ops.wm.save_as_mainfile(filepath=str(path),copy=True,compress=True)
bpy.context.preferences.filepaths.file_preview_type = previous_preview
print('Saved lineup to ' + str(path))
