"""Author the Abra and Geodude player rigs on their preserved Tripo multiview meshes.

blender --background --factory-startup --python-exit-code 1 --python assets/characters/rig-psychic-rock.py -- [form ...]
Then bun run assets:game player-<form>. +X forward, +Y left, +Z up, rest height 1.
Reuses the previous player batch's keying and planted-foot IK; no paid rig/animation jobs.
"""
import bpy
import bmesh
import json
import math
import runpy
import sys
import numpy as np
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent
shared = runpy.run_path(str(ROOT / 'rig-new-lines.py'))
clip, solve_leg, foot_offset, aim, smooth, segment = (
    shared[k] for k in ('clip', 'solve_leg', 'foot_offset', 'aim', 'smooth', 'segment'))

# Landmarks are normalized source-mesh coordinates, checked in front/side views.
# Arms: shoulder, elbow, wrist on the left side; mirrored for the right.
FORMS = {
    'abra': dict(body=.21, joint=.32, head=(.60,.70), waist=(.29,.48),
                 arms=[((.20,.17,.58),(.24,.27,.43),(.29,.32,.29))],
                 frames=24, duty=.24, stride=.32, lift=.10, crouch=.035, bob=.018, lean=.10, swing=.32),
    'kadabra': dict(body=.12, joint=.32, head=(.65,.74), waist=(.29,.47),
                    arms=[((.07,.19,.64),(.15,.31,.48),(.36,.40,.55))],
                    frames=24, duty=.25, stride=.32, lift=.09, crouch=.035, bob=.015, lean=.10, swing=.20),
    'alakazam': dict(body=-.07, joint=.36, head=(.63,.72), waist=(.31,.48),
                     arms=[((-.10,.17,.64),(-.08,.31,.46),(.15,.41,.47))],
                     frames=24, duty=.25, stride=.34, lift=.10, crouch=.035, bob=.015, lean=.12, swing=.20),
    'geodude': dict(arms=[((0,.40,.5),(.02,.78,.45),(.12,1.1,.64))], frames=30, wave=2.6),
    'graveler': dict(joint=.18, arms=[((0,.29,.38),(.03,.45,.28),(.13,.55,.18)),
                                     ((0,.28,.65),(.0,.48,.78),(.06,.48,.94))],
                     frames=24, duty=.17, stride=.19, lift=.065, crouch=.035, bob=.012, lean=.04, swing=.18),
    'golem': dict(joint=.29, arms=[((.04,.30,.56),(.08,.40,.49),(.20,.47,.57))],
                  frames=24, duty=.22, stride=.27, lift=.075, crouch=.035, bob=.015, lean=.06, swing=.22),
}


def repair_spoons_and_tail(obj, name):
    """Restore the three missing spoon bowls, close Kadabra's tail and attach its whiskers.

    Keep one material: added geometry samples the source handle's silver texel. Raw sources stay intact.
    """
    if name not in ('kadabra','alakazam'):
        return
    mesh=obj.data
    material=mesh.materials[0]
    bsdf=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    image=bsdf.inputs['Base Color'].links[0].from_node.image
    width,height=image.size
    pixels=np.array(image.pixels[:]).reshape(height,width,4)
    def swatch(rgb):
        distance=((pixels[:,:,:3]-np.array(rgb))**2).sum(2)
        y,x=np.unravel_index(distance.argmin(),distance.shape)
        return ((x+.5)/width,(y+.5)/height)
    silver=swatch((.6,.63,.59))
    if name=='kadabra':
        yellow,brown=swatch((.8,.64,.07)),swatch((.24,.16,.09))
        # The belly was visible from behind through an eleven-edge hole in the tail's underside.
        tailmesh=bmesh.new();tailmesh.from_mesh(mesh)
        bmesh.ops.remove_doubles(tailmesh,verts=[v for v in tailmesh.verts if v.co.x<-.13 and v.co.z<.5],dist=1e-5)
        border=[e for e in tailmesh.edges if e.is_boundary and all(v.co.x<-.13 and v.co.z<.5 for v in e.verts)]
        assert len(border)==11,(name,'tail opening changed',len(border))
        points=set(v for e in border for v in e.verts)
        center=tailmesh.verts.new(sum((v.co for v in points),Vector())/len(points)+Vector((-.015,0,-.025)))
        uv=tailmesh.loops.layers.uv.active
        for edge in border:
            loop=edge.link_loops[0]
            face=tailmesh.faces.new((loop.link_loop_next.vert,loop.vert,center))
            color=brown if -.245<face.calc_center_median().x<-.185 else yellow
            for corner in face.loops:corner[uv].uv=color
        tailmesh.to_mesh(mesh);tailmesh.free();mesh.update()
        # The two generated whiskers stop short of the muzzle. Attach their roots without changing the raw mesh.
        topology=bmesh.new();topology.from_mesh(mesh)
        bmesh.ops.remove_doubles(topology,verts=list(topology.verts),dist=1e-5)
        seen=set();parts=[]
        for vertex in topology.verts:
            if vertex in seen:continue
            todo=[vertex];seen.add(vertex);part=[]
            while todo:
                v=todo.pop();part.append(v.co.copy())
                for edge in v.link_edges:
                    other=edge.other_vert(v)
                    if other not in seen:seen.add(other);todo.append(other)
            parts.append(part)
        whiskers=[p for p in parts if len(p)==32 and .55<max(v.z for v in p)<.60]
        assert len(whiskers)==2,(name,'whisker islands changed')
        topology.free()
        for sign in (-1,1):
            points=next(p for p in whiskers if p[0].y*sign>0)
            whisker=[v for v in mesh.vertices if any((v.co-p).length<1e-5 for p in points)]
            root=max(whisker,key=lambda v:v.co.z).co.copy()
            face=[v.co for v in mesh.vertices if v.co.z>.6 and v.co.x>.18 and 0<v.co.y*sign<.18]
            target=min(face,key=lambda p:(p-root).length)
            delta=(target-root)*1.02
            for v in whisker:v.co+=delta*smooth(.43,.57,v.co.z)
    bm=bmesh.new();bm.from_mesh(mesh)
    uv=bm.loops.layers.uv.active
    centers=[(.4,-.41,.73)] if name=='kadabra' else [(.21,s*.41,.65) for s in (-1,1)]
    for x,y,z in centers:
        # A shallow, closed oval dish. Eight points around the rim and a centre on each side.
        rim=[bm.verts.new((x,y+.042*math.cos(k*math.tau/8),z+.068*math.sin(k*math.tau/8))) for k in range(8)]
        front=bm.verts.new((x+.008,y,z));back=bm.verts.new((x-.014,y,z))
        for k in range(8):
            for vertices in ((front,rim[k],rim[(k+1)%8]),(back,rim[(k+1)%8],rim[k])):
                face=bm.faces.new(vertices)
                for loop in face.loops:loop[uv].uv=silver
        # Narrow stem overlaps the retained handle inside the hand.
        lower=z-.20 if name=='kadabra' else z-.17
        a=[bm.verts.new((x+dx,y+dy,lower)) for dx,dy in ((-.008,-.008),(.008,-.008),(.008,.008),(-.008,.008))]
        b=[bm.verts.new((v.co.x,v.co.y,z-.055)) for v in a]
        for vertices in [a[::-1],b]+[[a[k],a[(k+1)%4],b[(k+1)%4],b[k]] for k in range(4)]:
            face=bm.faces.new(vertices)
            for loop in face.loops:loop[uv].uv=silver
    bm.to_mesh(mesh);bm.free();mesh.update()


def build(name):
    cfg = FORMS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    sources = list((ROOT/name/'generation').glob('**/model.glb'))
    assert len(sources) == 1, (name, sources)
    bpy.ops.import_scene.gltf(filepath=str(sources[0]))
    meshes = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
    assert len(meshes) == 1, (name, 'expected one source mesh')
    obj = meshes[0]
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh = obj.data
    low = min(v.co.z for v in mesh.vertices)
    height = max(v.co.z for v in mesh.vertices)-low
    for v in mesh.vertices:
        v.co = (v.co-Vector((0,0,low)))/height
    mesh.update()
    repair_spoons_and_tail(obj,name)

    rig = bpy.data.objects.new('Rig', bpy.data.armatures.new('Rig'))
    scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones = rig.data.edit_bones
    def bone(n, a, b, parent='Hip'):
        result = bones.new(n)
        result.head, result.tail = a, b
        if parent:
            result.parent = bones[parent]
        return result
    body=cfg.get('body',0)
    bone('Hip', (body,0,.4), (body,0,.5), None)
    if 'head' in cfg:
        bone('Chest',(body,0,.4),(body,0,.62))
        bone('Head',(body,0,.62),(body+.03,0,.82),'Chest')
    feet, foot_outer, arms = {}, {}, {}
    for side, sign in [('L',1),('R',-1)]:
        if 'joint' in cfg:
            sole = [v.co for v in mesh.vertices if v.co.z < .04 and v.co.y*sign > .045]
            assert sole, (name, side, 'no sole vertices')
            center = sum(sole, Vector())/len(sole)
            ankle = Vector((center.x-.02, center.y, .035))
            joint = cfg['joint']
            knee = Vector((center.x+.06,center.y*.96,joint*.52))
            bone('Upper'+side,(center.x-.02,center.y*.9,joint),knee)
            bone('Lower'+side,knee,ankle,'Upper'+side)
            bone('Foot'+side,ankle,ankle+Vector((.08,0,0)),'Lower'+side)
            feet[side] = ankle
            foot_outer[side] = max(abs(p.y) for p in sole)+.025
        for index, points in enumerate(cfg['arms']):
            a,b,c = (Vector(p)*Vector((1,sign,1)) for p in points)
            prefix = 'Upper' if index else ''
            upper, fore = prefix+'Arm'+side, prefix+'Forearm'+side
            bone(upper,a,b,'Chest' if 'head' in cfg else 'Hip')
            bone(fore,b,c,upper)
            arms[upper],arms[fore] = (a,b),(b,c)
    if name in ('abra','kadabra'):
        # This carrier isolates the tail from the legs when runtime adds its spring chain.
        bone('TailCarrier',(body-.12,0,.27),(body-.3,0,.3))
    bpy.ops.object.mode_set(mode='OBJECT')
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in rig.data.bones}
    for v in mesh.vertices:
        co = v.co
        weights = {'Hip':1}
        if 'head' in cfg:
            head = smooth(*cfg['head'],co.z)
            chest = smooth(*cfg['waist'],co.z)*(1-head)
            weights = {'Hip':1-head-chest,'Chest':chest,'Head':head}
        side = 'L' if co.y > 0 else 'R'
        if feet:
            j = cfg['joint']
            leg = (1-smooth(j*.65,j*1.05,co.z))*smooth(.02,.065,abs(co.y))
            leg *= 1-smooth(foot_outer[side],foot_outer[side]+.06,abs(co.y))
            if name in ('abra','kadabra'):
                leg *= smooth(body-.22,body-.10,co.x)
            if name=='golem':leg*=smooth(.10,.20,abs(co.y))
            sole = 1-smooth(.055,.10,co.z)
            shin = (1-sole)*(1-smooth(j*.35,j*.72,co.z))
            weights = {k:w*(1-leg) for k,w in weights.items()}
            weights.update({'Foot'+side:leg*sole,'Lower'+side:leg*shin,'Upper'+side:leg*(1-sole-shin)})
        distance, nearest = min((segment(co,*ab)[0],n) for n,ab in arms.items() if n.endswith(side))
        threshold = .36 if name == 'geodude' else .31 if name in ('graveler','golem') else .20
        if name=='abra' and co.z<.34:threshold=.29
        influence = smooth(threshold,threshold+.08,abs(co.y))*(1-smooth(.10,.23,distance))
        if name in ('geodude','graveler','golem'):
            influence=max(influence,smooth(threshold+.04,threshold+.15,abs(co.y)))
        if name=='golem':influence*=smooth(.32,.42,co.z)
        if name in ('kadabra','alakazam'):influence*=smooth(.32,.42,co.z)
        if influence:
            upper = nearest.replace('Forearm','Arm')
            fore = upper.replace('Arm','Forearm')
            elbow = arms[upper][1]
            along = (co-elbow).dot((arms[fore][1]-elbow).normalized())
            blend = smooth(-.035,.035,along)
            weights = {k:w*(1-influence) for k,w in weights.items()}
            weights[upper],weights[fore] = influence*(1-blend),influence*blend
        if name in ('kadabra','alakazam') and co.x>(.35 if name=='kadabra' else .13) and abs(co.y)>.35 and co.z>.32:
            weights={'Forearm'+side:1}
        if 'TailCarrier' in groups:
            tail = (1-smooth(body-.22,body-.12,co.x))*(1-smooth(.18,.25,abs(co.y)))*(1-smooth(.83,.90,co.z))
            weights = {k:w*(1-tail) for k,w in weights.items()}
            weights['TailCarrier'] = tail
        if feet and co.z<.10 and abs(co.y)<foot_outer[side]:
            # The complete sole, including wide outer toes, follows the solved foot rigidly.
            sole=1-smooth(.055,.10,co.z)
            weights={k:w*(1-sole) for k,w in weights.items()}
            weights['Foot'+side]=weights.get('Foot'+side,0)+sole
        top = sorted(((k,w) for k,w in weights.items() if w > 1e-5), key=lambda p:-p[1])[:4]
        total = sum(w for _,w in top)
        assert total > 0, (name, v.index)
        for k,w in top:
            groups[k].add([v.index],w/total,'REPLACE')
    mod = obj.modifiers.new('Rig','ARMATURE')
    mod.object, obj.parent = rig, rig
    assert all(0 < len(v.groups) <= 4 and abs(sum(g.weight for g in v.groups)-1) < 1e-5 for v in mesh.vertices)
    rig.animation_data_create()

    def pose(t, moving):
        pb = rig.pose.bones
        for b in pb:
            b.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        wave = math.sin(2*math.pi*t)
        lean = cfg.get('lean',.10) if moving else .015
        yaw = .035*wave if moving else .012*wave
        drop = (-cfg['crouch']-cfg['bob']*math.cos(4*math.pi*(t-cfg['duty']/2)) if moving else -.02+.004*wave) if feet else .12+.025*wave
        turn = Matrix.Rotation(yaw,3,'Z')@Matrix.Rotation(.02*wave,3,'X')@Matrix.Rotation(lean,3,'Y')
        hip = pb['Hip'];rest = hip.bone.matrix_local
        hip.matrix = Matrix.Translation(rest.translation+Vector((0,0,drop)))@(turn@rest.to_3x3()).to_4x4()
        bpy.context.view_layer.update()
        if 'head' in cfg:
            for n, rotation in [('Chest',Matrix.Rotation(-yaw*.7,3,'Z')@turn),('Head',Matrix.Rotation(yaw*.2,3,'Z'))]:
                b=pb[n]
                b.matrix=Matrix.Translation(b.head.copy())@(rotation@b.bone.matrix_local.to_3x3()).to_4x4()
                bpy.context.view_layer.update()
        for side,sign in [('L',1),('R',-1)]:
            if feet:
                fwd,up=foot_offset((t+(0 if side=='L' else .5))%1,cfg) if moving else (0,0)
                solve_leg(rig,side,feet[side]+Vector((fwd,0,up)))
            for index in range(len(cfg['arms'])):
                prefix='Upper' if index else ''
                swing=(cfg.get('swing',.16) if moving else .04)*math.sin(2*math.pi*t+sign*math.pi/2-index*.5)
                for part in ('Arm','Forearm'):
                    n=prefix+part+side
                    a,b=arms[n]
                    direction=turn@Matrix.Rotation(swing,3,'Y')@(b-a)
                    if name=='graveler' and index==0:
                        direction=Matrix.Rotation(sign*(.22 if moving else .05),3,'X')@direction
                    aim(pb[n],pb[n].head.copy(),direction)
        bpy.context.view_layer.update()

    clip(rig,'idle',72,lambda t:pose(t,False))
    clip(rig,'run',cfg['frames'],lambda t:pose(t,True))
    for b in rig.pose.bones:
        b.matrix_basis=Matrix.Identity(4)
    out=ROOT/name/'blender/model.glb'
    out.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=True,
                              export_animation_mode='NLA_TRACKS',export_draco_mesh_compression_enable=False)
    seconds=cfg['frames']/30
    travel=cfg['stride']/cfg['duty'] if feet else cfg['wave']
    report={'form':name,'bones':len(groups),'vertices':len(mesh.vertices),
            'triangles':sum(len(p.vertices)-2 for p in mesh.polygons),'runSeconds':seconds,'runCycles':1,
            'plantedSpeedPerHeight':travel/seconds,'credits':0}
    (out.parent/'rig.json').write_text(json.dumps(report,indent=2)+'\n')
    print('RESULT',json.dumps(report))


if __name__ == '__main__':
    for name in sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else FORMS:
        build(name)
