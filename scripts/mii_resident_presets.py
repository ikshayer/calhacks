"""Resident designs expressed entirely through Joey Carlino's editor controls."""
import bpy

PRESETS = {
    'nia': {
        'name': 'Nia',
        'description': 'Dark bob, soft eyes, warm brown skin, and a purple dress.',
        'parts': {'head': 'head.004', 'hair': 'hair.020', 'body': 'torso f',
                  'eye': 'eye9', 'eyebrow': 'eyebrow7', 'mouth': 'mouth4',
                  'nose': 'nose2.002'},
        'colors': {'Shirt': '#9855b4', 'Pants': '#33304a', 'Skin': '#a96943',
                   'Hair': '#241b22', 'Eyebrow': '#39252b', 'Eye Iris': '#553024',
                   'Lips': '#9d4f46'},
    },
    'theo': {
        'name': 'Theo',
        'description': 'Blond spiky hair, round glasses, a broad face, and a teal shirt.',
        'parts': {'head': 'head.007', 'hair': 'hair.113', 'body': 'torso m',
                  'eye': 'eye13', 'eyebrow': 'eyebrow10', 'mouth': 'mouth4',
                  'nose': 'nose3', 'glasses': 'glasses1'},
        'colors': {'Shirt': '#2c9695', 'Pants': '#28394b', 'Skin': '#f0c7a3',
                   'Hair': '#d6a14d', 'Eyebrow': '#8c632d', 'Eye Iris': '#476f82',
                   'Glasses Frame': '#373b44', 'Glasses Lens': '#b7dce2',
                   'Lips': '#bc7767'},
        'values': {'Lens Opacity': 0.06},
    },
    'rowan': {
        'name': 'Rowan',
        'description': 'Cropped silver hair, a moustache, a long face, and a mustard shirt.',
        'parts': {'head': 'head.010', 'hair': 'hair.067', 'body': 'torso m',
                  'eye': 'eye25', 'eyebrow': 'eyebrow17', 'mouth': 'mouth2',
                  'nose': 'nose12', 'mustache': 'mustache2'},
        'colors': {'Shirt': '#ce9340', 'Pants': '#334247', 'Skin': '#cc9b75',
                   'Hair': '#b4b8be', 'Eyebrow': '#6b7078', 'Eye Iris': '#52644c',
                   'Mustache': '#888d94', 'Lips': '#9e675b'},
    },
}

PICKER_BONES = {
    'head': 'head picker.002', 'hair': 'hair picker.002', 'body': 'body picker',
    'eye': 'eye picker.001', 'eyebrow': 'eyebrow picker.001',
    'mouth': 'mouth picker.001', 'nose': 'nose picker.001',
    'glasses': 'glasses picker.001', 'mustache': 'mustache picker.001',
}


def linear_color(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb) + (1,)


def apply_preset(resident_id):
    preset = PRESETS[resident_id]
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    arm = bpy.data.objects['Mii Armature']
    bpy.context.scene.frame_set(0)
    # These are the same proximity-based picker bones moved in the editor UI.
    for category, part_name in preset['parts'].items():
        if part_name not in bpy.data.objects:
            raise ValueError(f'Missing editor option: {part_name}')
        pb = arm.pose.bones[PICKER_BONES[category]]
        target = bpy.data.objects[part_name].matrix_world.translation.copy()
        matrix = pb.matrix.copy()
        matrix.translation = arm.matrix_world.inverted() @ target
        pb.matrix = matrix
        bpy.context.view_layer.update()
    group = bpy.data.node_groups['Color Control']
    outputs = group.nodes['Group Output'].inputs
    for name, value in preset['colors'].items():
        outputs[name].default_value = linear_color(value)
    for name, value in preset.get('values', {}).items():
        outputs[name].default_value = value
    # Keep the editor's displayed palette defaults consistent with the shader.
    for item in group.interface.items_tree:
        if item.item_type == 'SOCKET' and item.in_out == 'OUTPUT' and item.name in outputs:
            if item.name in preset['colors'] or item.name in preset.get('values', {}):
                item.default_value = outputs[item.name].default_value
    donor_name = 'torso f weights' if preset['parts']['body'] == 'torso f' else 'torso m weights'
    bpy.data.objects['body'].modifiers['DataTransfer'].object = bpy.data.objects[donor_name]
    bpy.context.view_layer.update()
    return preset
