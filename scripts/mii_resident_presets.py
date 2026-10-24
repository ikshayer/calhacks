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
    'maya': {
        'name': 'Maya',
        'description': 'Copper tied braids, round face, bright eyes, and a coral dress.',
        'parts': {'head': 'head.002', 'hair': 'hair.100', 'body': 'torso f',
                  'eye': 'eye16', 'eyebrow': 'eyebrow4', 'mouth': 'mouth6', 'nose': 'nose2.002'},
        'colors': {'Shirt': '#e47864', 'Pants': '#3c344a', 'Skin': '#bd8056',
                   'Hair': '#9e4e2e', 'Eyebrow': '#663a2a', 'Eye Iris': '#567d61', 'Lips': '#b45f53'},
    },
    'jules': {
        'name': 'Jules',
        'description': 'Textured dark hair, broad face, cheerful eyes, and a cobalt shirt.',
        'parts': {'head': 'head.016', 'hair': 'hair.025', 'body': 'torso m',
                  'eye': 'eye22', 'eyebrow': 'eyebrow6', 'mouth': 'mouth10', 'nose': 'nose4.002'},
        'colors': {'Shirt': '#4677c8', 'Pants': '#283444', 'Skin': '#784d36',
                   'Hair': '#201b19', 'Eyebrow': '#241d19', 'Eye Iris': '#8d643c', 'Lips': '#865046'},
    },
    'iris': {
        'name': 'Iris',
        'description': 'Long lavender hair, soft oval face, calm eyes, and a mint dress.',
        'parts': {'head': 'head.012', 'hair': 'hair.120', 'body': 'torso f',
                  'eye': 'eye18', 'eyebrow': 'eyebrow12', 'mouth': 'mouth5', 'nose': 'nose5.003'},
        'colors': {'Shirt': '#7fc6ae', 'Pants': '#464257', 'Skin': '#eed0b6',
                   'Hair': '#8b7ba7', 'Eyebrow': '#665372', 'Eye Iris': '#596d99', 'Lips': '#b77583'},
    },
    'omar': {
        'name': 'Omar',
        'description': 'Close-cropped hair, rectangular glasses, a moustache, and a navy shirt.',
        'parts': {'head': 'head.023', 'hair': 'hair.095', 'body': 'torso m',
                  'eye': 'eye7', 'eyebrow': 'eyebrow18', 'mouth': 'mouth3',
                  'nose': 'nose8.002', 'glasses': 'glasses2', 'mustache': 'mustache4'},
        'colors': {'Shirt': '#394d78', 'Pants': '#54505b', 'Skin': '#ab754d',
                   'Hair': '#392d27', 'Eyebrow': '#342a24', 'Eye Iris': '#62452e',
                   'Mustache': '#392d27', 'Glasses Frame': '#544b43',
                   'Glasses Lens': '#c1d7ce', 'Lips': '#9b5e4a'},
        'values': {'Lens Opacity': 0.06},
    },
    'pip': {
        'name': 'Pip',
        'description': 'Tall mint spikes, an angular face, lively eyes, and an apricot shirt.',
        'parts': {'head': 'head.031', 'hair': 'hair.030', 'body': 'torso m',
                  'eye': 'eye30', 'eyebrow': 'eyebrow9', 'mouth': 'mouth12', 'nose': 'nose3'},
        'colors': {'Shirt': '#edb775', 'Pants': '#3b5155', 'Skin': '#d5a279',
                   'Hair': '#6fafa3', 'Eyebrow': '#3b726b', 'Eye Iris': '#376f72', 'Lips': '#a56550'},
    },
    'vera': {
        'name': 'Vera',
        'description': 'Side-parted auburn hair, sunglasses, a pointed face, and a rose dress.',
        'parts': {'head': 'head.019', 'hair': 'hair.085', 'body': 'torso f',
                  'eye': 'eye35', 'eyebrow': 'eyebrow14', 'mouth': 'mouth8',
                  'nose': 'nose6', 'glasses': 'glasses5'},
        'colors': {'Shirt': '#b86683', 'Pants': '#493c52', 'Skin': '#e1af90',
                   'Hair': '#674237', 'Eyebrow': '#593a32', 'Eye Iris': '#63795c',
                   'Glasses Frame': '#724d68', 'Glasses Lens': '#dbd2e6', 'Lips': '#ac596b'},
        'values': {'Lens Opacity': 0.06},
    },
    'luna': {
        'name': 'Luna', 'description': 'Indigo tied hair, a rounded face, and a honey dress.',
        'parts': {'head': 'head.003', 'hair': 'hair.010', 'body': 'torso f',
                  'eye': 'eye5', 'eyebrow': 'eyebrow2', 'mouth': 'mouth9', 'nose': 'nose1.002'},
        'colors': {'Shirt': '#d9ad54', 'Pants': '#464059', 'Skin': '#efc7a5',
                   'Hair': '#404a7b', 'Eyebrow': '#32395b', 'Eye Iris': '#6a87a1', 'Lips': '#ba7b71'},
    },
    'felix': {
        'name': 'Felix', 'description': 'Sandy side-swept hair, a gentle face, and a sage shirt.',
        'parts': {'head': 'head.006', 'hair': 'hair.005', 'body': 'torso m',
                  'eye': 'eye2', 'eyebrow': 'eyebrow3', 'mouth': 'mouth7', 'nose': 'nose10.002'},
        'colors': {'Shirt': '#85a780', 'Pants': '#485663', 'Skin': '#e4b68d',
                   'Hair': '#c8aa70', 'Eyebrow': '#8c744b', 'Eye Iris': '#668164', 'Lips': '#ad7761'},
    },
    'zuri': {
        'name': 'Zuri', 'description': 'Long dark textured hair, a narrow face, and a sunflower dress.',
        'parts': {'head': 'head.017', 'hair': 'hair.035', 'body': 'torso f',
                  'eye': 'eye12', 'eyebrow': 'eyebrow16', 'mouth': 'mouth11', 'nose': 'nose11.002'},
        'colors': {'Shirt': '#ebbd43', 'Pants': '#493f4b', 'Skin': '#68412f',
                   'Hair': '#30242d', 'Eyebrow': '#251d22', 'Eye Iris': '#996c42', 'Lips': '#8f514e'},
    },
    'hugo': {
        'name': 'Hugo', 'description': 'Wavy chestnut hair, a moustache, and a periwinkle shirt.',
        'parts': {'head': 'head.027', 'hair': 'hair.040', 'body': 'torso m',
                  'eye': 'eye19', 'eyebrow': 'eyebrow20', 'mouth': 'mouth14',
                  'nose': 'nose14.002', 'mustache': 'mustache1'},
        'colors': {'Shirt': '#8794c8', 'Pants': '#414555', 'Skin': '#c08760',
                   'Hair': '#6b4633', 'Eyebrow': '#4e3528', 'Eye Iris': '#6c7450',
                   'Mustache': '#563a2a', 'Lips': '#a86552'},
    },
    'cleo': {
        'name': 'Cleo', 'description': 'A dark bob, bold glasses, and a tangerine dress.',
        'parts': {'head': 'head.008', 'hair': 'hair.050', 'body': 'torso f',
                  'eye': 'eye29', 'eyebrow': 'eyebrow8', 'mouth': 'mouth15',
                  'nose': 'nose13.002', 'glasses': 'glasses3'},
        'colors': {'Shirt': '#db8b48', 'Pants': '#414451', 'Skin': '#c99a76',
                   'Hair': '#292936', 'Eyebrow': '#292735', 'Eye Iris': '#7a6248',
                   'Glasses Frame': '#d3b985', 'Glasses Lens': '#d4dfda', 'Lips': '#a96766'},
        'values': {'Lens Opacity': 0.06},
    },
    'eden': {
        'name': 'Eden', 'description': 'A rounded lilac bob, relaxed eyes, and an icy blue dress.',
        'parts': {'head': 'head.015', 'hair': 'hair.055', 'body': 'torso f',
                  'eye': 'eye38', 'eyebrow': 'eyebrow5', 'mouth': 'mouth16', 'nose': 'nose15.002'},
        'colors': {'Shirt': '#8fbdd2', 'Pants': '#4e5166', 'Skin': '#edcbb7',
                   'Hair': '#ad8eaf', 'Eyebrow': '#775f80', 'Eye Iris': '#627c9e', 'Lips': '#b5788b'},
    },
    'kai': {
        'name': 'Kai', 'description': 'Close-cut dark hair, an angular face, and a seafoam shirt.',
        'parts': {'head': 'head.029', 'hair': 'hair.070', 'body': 'torso m',
                  'eye': 'eye24', 'eyebrow': 'eyebrow11', 'mouth': 'mouth18', 'nose': 'nose16.002'},
        'colors': {'Shirt': '#5db2ac', 'Pants': '#354b60', 'Skin': '#9d6c4e',
                   'Hair': '#273338', 'Eyebrow': '#253033', 'Eye Iris': '#476a6b', 'Lips': '#915a4c'},
    },
    'sage': {
        'name': 'Sage', 'description': 'Layered silver hair, glasses, and a plum shirt.',
        'parts': {'head': 'head.036', 'hair': 'hair.080', 'body': 'torso m',
                  'eye': 'eye40', 'eyebrow': 'eyebrow23', 'mouth': 'mouth19',
                  'nose': 'nose3', 'glasses': 'glasses4'},
        'colors': {'Shirt': '#805b89', 'Pants': '#4c4c5d', 'Skin': '#dfb28e',
                   'Hair': '#b7c7c9', 'Eyebrow': '#71868d', 'Eye Iris': '#668b87',
                   'Glasses Frame': '#456877', 'Glasses Lens': '#d4e3e5', 'Lips': '#ae7768'},
        'values': {'Lens Opacity': 0.06},
    },
    'arlo': {
        'name': 'Arlo', 'description': 'An auburn top bun, a moustache, and a forest shirt.',
        'parts': {'head': 'head.021', 'hair': 'hair.090', 'body': 'torso m',
                  'eye': 'eye15', 'eyebrow': 'eyebrow13', 'mouth': 'mouth20',
                  'nose': 'nose18.002', 'mustache': 'mustache3'},
        'colors': {'Shirt': '#52745b', 'Pants': '#47423c', 'Skin': '#bd8b65',
                   'Hair': '#884e38', 'Eyebrow': '#613c2c', 'Eye Iris': '#7b7550',
                   'Mustache': '#70422e', 'Lips': '#a66b59'},
    },
    'bea': {
        'name': 'Bea', 'description': 'Pink tied-up hair, bright eyes, and a berry dress.',
        'parts': {'head': 'head.009', 'hair': 'hair.125', 'body': 'torso f',
                  'eye': 'eye33', 'eyebrow': 'eyebrow15', 'mouth': 'mouth21', 'nose': 'nose7.002'},
        'colors': {'Shirt': '#c779a0', 'Pants': '#5c4260', 'Skin': '#ecc29d',
                   'Hair': '#cb8fa2', 'Eyebrow': '#916276', 'Eye Iris': '#728b6c', 'Lips': '#b16a80'},
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
