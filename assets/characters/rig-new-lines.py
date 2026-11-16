"""Blender rigs for the ghost, dragon and fighting player lines; no paid rig jobs.

blender --background --factory-startup --python-exit-code 1 --python assets/characters/rig-new-lines.py -- [form ...]
Reuses the established quadruped pipeline's keying and planted-foot IK. All source meshes are
new Tripo multiview generations. Coordinates below are +X forward, +Z up, normalized to height 1.
"""
import bpy
import bmesh
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector, kdtree

ROOT = Path(__file__).resolve().parent
# Load the shared authoring functions without running the quadruped batch entry point.
shared = {"__file__": str(ROOT / "rig-quadrupeds.py")}
exec((ROOT / "rig-quadrupeds.py").read_text().split('\nargv = sys.argv')[0], shared)
clip, solve_leg, foot_offset, aim = (shared[k] for k in ('clip', 'solve_leg', 'foot_offset', 'aim'))
FORMS = ['gastly', 'haunter', 'gengar', 'dratini', 'dragonair', 'dragonite', 'machop', 'machoke', 'machamp']
GHOSTS = FORMS[:2]
SNAKES = FORMS[3:5]
# Serpents: neck = centroid height below which the centreline is body, not neck; ramp = body length over which the
# coil turns straight back; tip = tail-tip rise. Slither: lateral undulation, a sine travelling head→tail whose
# wavelength `wave` (model units) the body covers each loop, so the wave stands still on the ground at the clip's
# ground speed wave / RUN_SECONDS (formModels.runClipSpeed = that × height). amp: lateral amplitude at the neck base
# and the tail tip; pitch: forward lean of the neck while slithering (the head stays level, a little lower).
SNAKE = {
    'dratini': dict(neck=.2, ramp=.18, tip=.05, wave=1.32, amp=(.04, .22), pitch=.45, idle=(.05, .22)),
    'dragonair': dict(neck=.2, ramp=.18, tip=.06, wave=1.42, amp=(.03, .17), pitch=.22, idle=(.04, .18)),
}
RUN_SECONDS = 1
# Floating ghosts drift along a bobbing path of wavelength `wave` (model units): one bob per loop, so the path keeps
# its shape at any speed (formModels.runClipSpeed = wave × height). Haunter's hands trail `trail` behind while
# drifting and dart back level once per loop, left and right half a loop apart.
GHOST = {'gastly': dict(wave=2.6, lean=.14), 'haunter': dict(wave=2.6, lean=.18, trail=.10)}
# Fighters (the Machop line): a planted-foot run, one gait cycle in `frames` (30 fps). Feet: duty = planted share of
# the cycle, stride = travel while planted (model units), reach = where that stretch is centred, lift = swing height,
# spread = stance width × rest. Body: crouch + bob (lowest at mid-stance), lean (pitch), twist (hip yaw, shoulders
# turn back past straight by `chest`), roll / sway (hip tilt and drift over the planted foot), shoulder (shoulder
# roll). Arms: a boxer's guard (upper arm and forearm directions, +X forward, +Y out, +Z up) pumping `swing` rad
# against the legs; Machamp's raised pair (`upper`) keeps a smaller pump `lag` of a cycle behind. head / waist: the
# skin bands where the body hands over to the head and the chest.
FIGHTER = {
    'machop': dict(frames=24, duty=.24, stride=.32, reach=-.02, lift=.10, spread=1, crouch=.035, bob=.022,
                   lean=.16, twist=.16, chest=.3, roll=.04, sway=.008, shoulder=.04, swing=.55, bounce=.012,
                   guard=((-.05, .45, -.89), (.8, -.05, .6)), head=(.62, .74), waist=(.28, .46)),
    'machoke': dict(frames=24, duty=.27, stride=.36, reach=-.02, lift=.075, spread=1.1, crouch=.05, bob=.012,
                    lean=.12, twist=.12, chest=.38, roll=.06, sway=.018, shoulder=.09, swing=.45, bounce=0,
                    guard=((-.1, .35, -.93), (.85, -.1, .5)), head=(.74, .83), waist=(.30, .50)),
    'machamp': dict(frames=24, duty=.26, stride=.34, reach=-.02, lift=.07, spread=1.1, crouch=.045, bob=.01,
                    lean=.12, twist=.12, chest=.38, roll=.06, sway=.02, shoulder=.1, swing=.4, bounce=0,
                    guard=((-.1, .4, -.9), (.85, -.1, .5)), upper=((-.1, .8, .45), (.75, -.2, .6)), lag=.08,
                    head=(.77, .85), waist=(.30, .50)),
    # Dragonite stands in the fighters' guard at rest (arms forward, belly breathing, tail and wings idling); it flies
    # when it moves (GLIDE).
    'dragonite': dict(frames=24, duty=.24, stride=.30, reach=0, lift=.07, spread=1, crouch=.03, bob=.022,
                      lean=.12, twist=.1, chest=.18, roll=.06, sway=.02, shoulder=.03, swing=.32, bounce=0,
                      guard=((.35, .45, -.82), (.95, .1, .3)), head=(.70, .80), waist=(.30, .50),
                      belly=.012, tail=.6, wing=(.22, .07)),
    # Gengar: a springy hop-run with a flight phase (short duty, deep bob) that squashes the body down onto the hips
    # at each landing (`squash`), arms out to the sides swinging fore and aft (about Z), grinning forward.
    'gengar': dict(frames=20, duty=.18, stride=.28, reach=0, lift=.09, spread=1.05, crouch=.02, bob=.04,
                   lean=.2, twist=.1, chest=.16, roll=.07, sway=.02, shoulder=.03, swing=.32, bounce=.015, axis='Z',
                   guard=((.15, .85, -.5), (.4, .8, -.45)), head=(.55, .75), waist=(.25, .45),
                   squash=.035, tail=1),
}
MACHOPS = ['machop', 'machoke', 'machamp']
# Dragonite's sim speed would need about three strides a second from its short legs, so it flies when it moves: a low
# hover (`hover` up, `heave` more at the end of each downstroke), leaning `lean` into the flight, one wing beat of
# `beat` rad per loop, legs tucked back, tail streaming level. The loop covers `wave` model units (runClipSpeed =
# wave × height), so the beat rate follows the ground speed.
GLIDE = dict(wave=2.3, hover=.13, heave=.035, lean=.38, beat=.75)
FIGHTERS = list(FIGHTER)
BODY_BONES = 9
SPREAD = 1.5

def smooth(a, b, v):
    t = max(0, min(1, (v-a)/(b-a)))
    return t*t*(3-2*t)

def segment(co, a, b):
    ab = b-a
    t = max(0, min(1, (co-a).dot(ab)/ab.length_squared))
    return (co-a-ab*t).length, t

def centerline(mesh, bins=40):
    """Tube centreline of a serpent mesh: rings of equal geodesic distance from the tail tip, their centroids.
    Returns (per-vertex geodesic distance, centroids from tail tip to head, each ring's lowest z, ring width)."""
    co=[v.co.copy() for v in mesh.vertices];tree=kdtree.KDTree(len(co))
    for i,c in enumerate(co):tree.insert(c,i)
    tree.balance()
    # glTF splits vertices along UV seams; weld them for connectivity only.
    rep=[min(j for _,j,_ in tree.find_range(c,1e-5)) for c in co]
    adj={}
    for e in mesh.edges:
        a,b=rep[e.vertices[0]],rep[e.vertices[1]]
        if a!=b:adj.setdefault(a,set()).add(b);adj.setdefault(b,set()).add(a)
    def dijkstra(start):
        import heapq
        dist={start:0.0};todo=[(0.0,start)]
        while todo:
            d,v=heapq.heappop(todo)
            if d>dist[v]:continue
            for w in adj.get(v,()):
                nd=d+(co[v]-co[w]).length
                if nd<dist.get(w,1e9):dist[w]=nd;heapq.heappush(todo,(nd,w))
        return dist
    top=max(range(len(co)),key=lambda i:co[i].z)
    far=dijkstra(rep[top]);tail=max(far,key=far.get);dist=dijkstra(tail)
    g=[dist.get(rep[i]) for i in range(len(co))]
    reached=[i for i in range(len(co)) if g[i] is not None]
    # Islands (eyes, gems) take the distance of the nearest connected vertex.
    near=kdtree.KDTree(len(reached))
    for k,i in enumerate(reached):near.insert(co[i],k)
    near.balance()
    g=[x if x is not None else g[reached[near.find(co[i])[1]]] for i,x in enumerate(g)]
    top_g=max(g);step=top_g/bins;rings=[[] for _ in range(bins)]
    for i in set(rep):rings[min(bins-1,int(g[i]/step))].append(co[i])
    # A ring between two long edges can be empty: interpolate it from its neighbours.
    full=[k for k,r in enumerate(rings) if r]
    for k,r in enumerate(rings):
        if not r:a=max(j for j in full if j<k);b=min(j for j in full if j>k);rings[k]=rings[a]+rings[b]
    centres=[sum(r,Vector())/len(r) for r in rings]
    for _ in range(5):centres=[centres[0]]+[(centres[k-1]+centres[k]*2+centres[k+1])/4 for k in range(1,bins-1)]+[centres[-1]]
    floors=[min(c.z for c in r) for r in rings]
    return g,step,centres,floors,rep,adj

def straighten(mesh, name):
    """Unbend a coiled serpent so its body lies straight back (-X) on the ground behind the upright neck.
    Rest pose then holds the straight body every clip waves; the head and neck stay as generated."""
    g,step,C,floors,rep,adj=centerline(mesh)
    n=len(C);top=max(range(n),key=lambda k:C[k].z)
    base=max(k for k in range(top) if C[k].z<SNAKE[name]['neck'])
    print(name,'centreline',[tuple(round(x,3) for x in c) for c in C],'base',base)
    P=list(C);ramp=SNAKE[name]['ramp'];heading0=math.atan2(*reversed((C[base-1]-C[base]).xy));run=0
    for k in range(base-1,-1,-1):
        seg=(C[k+1]-C[k]).length;run+=seg;w=smooth(0,ramp,run)
        turn=(math.pi-heading0+math.pi)%(2*math.pi)-math.pi;h=heading0+turn*w
        P[k]=P[k+1]+Vector((math.cos(h),math.sin(h),0))*seg
        # The body settles onto the ground sooner than it turns, so it doesn't arch up into the neck.
        settle=smooth(0,ramp*.5,run)
        P[k].z=C[k].z-settle*(floors[k]-SNAKE[name]['tip']*smooth(.75,1,run/sum((C[j+1]-C[j]).length for j in range(base))))
    # Then shift the straight run sideways in line behind the head.
    shift=C[top].y-P[0].y;run=0
    for k in range(base-1,-1,-1):run+=(C[k+1]-C[k]).length;P[k].y+=shift*smooth(0,ramp*2,run)
    def tangent(Q,k):return (Q[min(k+1,n-1)]-Q[max(k-1,0)]).normalized()
    q=[tangent(C,k).rotation_difference(tangent(P,k)) if k<base else Quaternion() for k in range(n)]
    u={}
    for i,v in enumerate(mesh.vertices):
        if rep[i]!=i:continue
        kg=int(g[i]/step);best=None
        for k in range(max(0,kg-3),min(n-1,kg+3)):
            d,t=segment(v.co,C[k],C[k+1])
            if best is None or d<best[0]:best=(d,k,t)
        u[i]=best[1]+best[2]
    # The coil bends about as tightly as the body is thick, so one ring's rigid turn would fold the skin there:
    # blend the turns of the nearby rings (smooth linear-blend skinning) instead.
    s=[]
    for i,v in enumerate(mesh.vertices):
        x=u[rep[i]];w=[math.exp(-.5*((x-k)/SPREAD)**2) for k in range(n)];total=sum(w)
        v.co=sum(((P[k]+q[k]@(v.co-C[k]))*(wk/total) for k,wk in enumerate(w) if wk>1e-4),Vector());s.append(x)
    taper(mesh,s,P,base)
    return s,P,base

def taper(mesh, s, P, base, reach=4):
    """The generated tail is a size thinner than the body and steps up within one ring, which reads as a hump once
    the body lies straight: rescale each ring's cross-section to its neighbourhood's mean girth (fading out before
    the neck), then set it back down on the ground."""
    n=len(P);rings=[[] for _ in range(n)];frame={}
    for i,v in enumerate(mesh.vertices):
        x=s[i];k=min(int(x),n-2);c=P[k].lerp(P[k+1],x-k);axis=(P[k+1]-P[k]).normalized()
        d=v.co-c;d-=axis*d.dot(axis);frame[i]=(c+axis*(v.co-c).dot(axis),d)
        rings[min(n-1,round(x))].append(d.length)
    girth=[sum(r)/len(r) if r else None for r in rings]
    full=[k for k in range(n) if girth[k]]
    girth=[g if g else girth[min(full,key=lambda j:abs(j-k))] for k,g in enumerate(girth)]
    def mean(k):ks=range(max(0,k-reach),min(base,k+reach+1));return sum(girth[j] for j in ks)/len(ks)
    scale=[mean(k)/girth[k]*(1-smooth(base-3,base-1,k))+smooth(base-3,base-1,k) if k<base else 1 for k in range(n)]
    floor=[1e9]*n;moved=[1e9]*n
    for i,v in enumerate(mesh.vertices):
        x=s[i];k=min(int(x),n-2);f=scale[k]+(scale[k+1]-scale[k])*(x-k);c,d=frame[i]
        r=min(n-1,round(x));floor[r]=min(floor[r],v.co.z);v.co=c+d*f;moved[r]=min(moved[r],v.co.z)
    for i,v in enumerate(mesh.vertices):
        r=min(n-1,round(s[i]))
        if r<base:v.co.z+=floor[r]-moved[r]

def build(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    sources = list((ROOT/name/'generation').glob('**/model.glb'))
    assert len(sources)==1, (name, sources)
    bpy.ops.import_scene.gltf(filepath=str(sources[0]))
    obj = next(o for o in scene.objects if o.type=='MESH')
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    lo=min(v.co.z for v in obj.data.vertices);height=max(v.co.z for v in obj.data.vertices)-lo
    for v in obj.data.vertices:v.co=(v.co-Vector((0,0,lo)))/height
    mesh=obj.data
    if name == 'dragonite':
        # The generated antennae have small gaps at their roots; move each intact island to the scalp.
        bm=bmesh.new();bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
        seen=set();parts=[]
        for vertex in bm.verts:
            if vertex in seen:continue
            todo=[vertex];seen.add(vertex);part=[]
            while todo:
                v=todo.pop();part.append(v.co.copy())
                for edge in v.link_edges:
                    other=edge.other_vert(v)
                    if other not in seen:seen.add(other);todo.append(other)
            parts.append(part)
        parts.sort(key=len,reverse=True)
        assert len(parts)==3 and all(max(p.z for p in part)>.9 for part in parts[1:])
        tree=kdtree.KDTree(len(parts[0]))
        for i,co in enumerate(parts[0]):tree.insert(co,i)
        tree.balance()
        for part in parts[1:]:
            _,start,end=min((tree.find(co)[2],co,tree.find(co)[0]) for co in part)
            delta=(end-start)*1.04
            for v in mesh.vertices:
                if any((v.co-co).length<1e-6 for co in part):v.co+=delta
        bm.free()
    if name in SNAKES:s,P,base=straighten(mesh,name)
    rig=bpy.data.objects.new('Rig',bpy.data.armatures.new('Rig'));scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones=rig.data.edit_bones
    def bone(n,a,b,parent='Hip'):
        x=bones.new(n);x.head=a;x.tail=b
        if parent:x.parent=bones[parent]
        return x
    chains={};feet={};arms={}
    if name in SNAKES:
        # Two chains from the neck base: Body0.. straight back to the tail tip, Neck0.. up to the crown. Knots are
        # centreline parameters (fractional ring index, 0 = tail tip); skin blends between neighbouring bones.
        def at(u):k=min(int(u),len(P)-2);return P[k].lerp(P[k+1],u-k)
        arc=[0.0]
        for k in range(base):arc.append(arc[-1]+(P[k+1]-P[k]).length)
        def by_arc(a):
            k=next(k for k in range(base) if arc[k+1]>=a);return k+(a-arc[k])/(arc[k+1]-arc[k])
        body=[by_arc(arc[base]*(1-j/BODY_BONES)) for j in range(BODY_BONES+1)]
        top=len(P)-1;neck=[base+(top-base)*f for f in (0,.4,.72,1)]
        bone('Hip',at(base)*Vector((1,1,0)),at(base)*Vector((1,1,0))+Vector((0,0,.08)),None)
        knots=[]
        for prefix,ks in (('Body',body),('Neck',neck)):
            for i,(a,b) in enumerate(zip(ks,ks[1:])):
                n=f'{prefix}{i}';bone(n,at(a),at(b),'Hip' if i==0 else f'{prefix}{i-1}');chains[n]=(a,b);knots.append(((a+b)/2,n))
        knots.sort()
    else:
        hipx=0
        bone('Hip',(hipx,0,.4),(hipx,0,.5),None)
        bone('Chest',(0,0,.4),(0,0,.65));bone('Head',(0,0,.65),(.02,0,.87),'Chest')
        if name=='haunter':
            for side,s in [('L',1),('R',-1)]:bone('Hand'+side,(.24,s*.5,.22),(.40,s*.6,.13))
        if name=='gastly':
            bone('Mist',(-.16,0,.5),(-.16,0,.75))
        if name in ['gengar','dragonite','machop','machoke','machamp']:
            joint={'gengar':.25,'dragonite':.29,'machop':.36,'machoke':.44,'machamp':.39}[name]
            for side,s in [('L',1),('R',-1)]:
                low=[v.co for v in mesh.vertices if v.co.z<.045 and v.co.y*s>.04]
                assert low, (name,side,'missing sole')
                center=sum(low,Vector())/len(low);ankle=Vector((center.x-.02,center.y,.035))
                knee=Vector((center.x+.08,center.y*.93,joint*.52))
                bone('Upper'+side,(center.x-.02,center.y*.9,joint),knee)
                bone('Lower'+side,knee,ankle,'Upper'+side)
                bone('Foot'+side,ankle,ankle+Vector((.08,0,0)),'Lower'+side)
                feet[side]=ankle
            armcfg={'gengar':(.49,.28,.15,.53,.30),'dragonite':(.60,.18,.22,.39,.43),'machop':(.59,.17,.04,.44,.48),'machoke':(.69,.22,.02,.42,.40),'machamp':(.55,.19,.06,.43,.28)}[name]
            shoulder,sy,ex,ey,ez=armcfg
            for side,s in [('L',1),('R',-1)]:
                a=Vector((0,sy*s,shoulder));b=Vector((ex,ey*s,ez));mid=a.lerp(b,.52)
                bone('Arm'+side,a,mid,'Chest');bone('Forearm'+side,mid,b,'Arm'+side)
                arms['Arm'+side]=(a,mid);arms['Forearm'+side]=(mid,b)
                if name=='machamp':
                    a=Vector((-.05,.21*s,.67));b=Vector((0,.43*s,.87));c=Vector((.06,.46*s,.98))
                    bone('UpperArm'+side,a,b,'Chest');bone('UpperForearm'+side,b,c,'UpperArm'+side)
                    arms['UpperArm'+side]=(a,b);arms['UpperForearm'+side]=(b,c)
            if name=='dragonite':
                for side,s in [('L',1),('R',-1)]:bone('Wing'+side,(-.13,s*.11,.65),(-.23,s*.4,.77),'Chest')
            if name in ['dragonite','machop','gengar']:
                bone('Tail',(-.1,0,.24),(-.32,0,.22))
    bpy.ops.object.mode_set(mode='OBJECT')
    groups={b.name:obj.vertex_groups.new(name=b.name) for b in rig.data.bones}
    for v in mesh.vertices:
        co=v.co;w={}
        if name in SNAKES:
            u=s[v.index];j=max(0,min(len(knots)-2,next((j for j,(m,_) in enumerate(knots) if m>u),len(knots))-1))
            (m0,a),(m1,b)=knots[j],knots[j+1];f=smooth(m0,m1,u)
            w={a:1-f,b:f}
        elif name=='gastly':
            radius=math.hypot(co.y,(co.z-.48));mist=smooth(.34,.43,radius)*(1-smooth(.03,.16,co.x))
            w={'Head':1-mist,'Mist':mist}
        elif name=='haunter':
            hand=smooth(.38,.46,abs(co.y))*(1-smooth(.30,.40,co.z))
            w={'Head':1-hand,'Hand'+('L' if co.y>0 else 'R'):hand}
        else:
            head=smooth(*FIGHTER[name]['head'],co.z) if name in FIGHTERS else smooth(.60,.75,co.z)
            chest=smooth(*FIGHTER[name]['waist'],co.z)*(1-head) if name in FIGHTERS else 0
            w={'Hip':1-head-chest,'Chest':chest,'Head':head} if chest else {'Hip':1-head,'Head':head}
            side='L' if co.y>0 else 'R';ankle=feet[side];joint=rig.data.bones['Upper'+side].head_local.z
            leg=(1-smooth(joint*.72,joint*1.13,co.z))*smooth(*((.02,.07) if name in MACHOPS else (.035,.10)),abs(co.y))
            if name=='dragonite':leg*=smooth(-.18,-.08,co.x)
            if leg:
                sole=1-smooth(.055,.13,co.z);shin=(1-sole)*(1-smooth(joint*.34,joint*.75,co.z))
                w={k:x*(1-leg) for k,x in w.items()};w.update({'Foot'+side:leg*sole,'Lower'+side:leg*shin,'Upper'+side:leg*(1-sole-shin)})
            eligible={n:ab for n,ab in arms.items() if n.endswith(side)}
            dist,n=min((segment(co,*ab)[0],n) for n,ab in eligible.items())
            # Fighters' big fists sit past their bone ends: reach farther so no knuckle stays on the chest.
            arm=smooth(.20 if name=='gengar' else .17,.30 if name=='gengar' else .25,abs(co.y))*(1-smooth(*((.16,.26) if name in MACHOPS else (.10,.20)),dist))
            if name=='dragonite':arm*=smooth(-.12,0,co.x)
            if arm and name in FIGHTERS:
                # Blend across the elbow, which these clips bend hard.
                upper=n.replace('Forearm','Arm');fore=upper.replace('Arm','Forearm')
                a,_=arms[upper];_,b=arms[fore];_,f=segment(co,a,b);f=smooth(.42,.62,f)
                w={k:x*(1-arm) for k,x in w.items()};w[upper]=arm*(1-f);w[fore]=arm*f
            elif arm:w={k:x*(1-arm) for k,x in w.items()};w[n]=arm
            if name=='dragonite':
                wing=(1-smooth(-.08,.02,co.x))*smooth(.17,.25,abs(co.y))*smooth(.47,.58,co.z)
                w={k:x*(1-wing) for k,x in w.items()};w['Wing'+side]=wing
            if 'Tail' in groups:
                tail=((1-smooth(-.30,-.10,co.x))*(1-smooth(.60,.70,co.z)) if name=='dragonite' else (1-smooth(-.24,-.13,co.x))*(1-smooth(.27,.40,co.z))*(1-smooth(.11,.19,abs(co.y))))
                w={k:x*(1-tail) for k,x in w.items()};w['Tail']=tail
        top=sorted(((k,x) for k,x in w.items() if x>1e-5),key=lambda item:-item[1])[:4];total=sum(x for _,x in top)
        assert total>0
        for k,x in top:groups[k].add([v.index],x/total,'REPLACE')
    mod=obj.modifiers.new('Rig','ARMATURE');mod.object=rig;obj.parent=rig
    rig.animation_data_create()
    def slither(t,moving):
        cfg=SNAKE[name];pb=rig.pose.bones;rest=rig.data.bones
        body=[n for n in chains if n.startswith('Body')];length=sum(rest[n].length for n in body)
        def offset(x):
            # Lateral offset at body length x behind the neck base.
            f=x/length
            if moving:
                a0,a1=cfg['amp'];return (a0+(a1-a0)*f**1.3)*math.sin(2*math.pi*(x/cfg['wave']-t))
            # At rest: a lazy S, breathing a little, and the tail tip curling in and out.
            a0,a1=cfg['idle'];return (a0*f*math.sin(2*math.pi*x/.95+.5+.25*math.sin(2*math.pi*t))
                                       +a1*f**2.5*(.55+.45*math.sin(2*math.pi*t-.6)))
        x=0;at=rest[body[0]].head_local.copy()
        for n in body:
            b=rest[n];mid=x+b.length/2;slope=(offset(mid+.01)-offset(mid-.01))/.02
            direction=Matrix.Rotation(-math.atan(slope),3,'Z')@(b.tail_local-b.head_local).normalized()
            aim(pb[n],at,direction);at=at+direction*b.length;x+=b.length
        # The neck leans into the slither and the head levels out again; at rest it breathes and looks about.
        lean=cfg['pitch'] if moving else .06
        bob=.025*math.sin(4*math.pi*t) if moving else .03*math.sin(2*math.pi*t)
        look=.012*math.sin(2*math.pi*t) if moving else .06*math.sin(2*math.pi*t+1)
        turn=Matrix.Identity(3);at=rest['Neck0'].head_local.copy()
        for n,(pitch,yaw) in zip(['Neck0','Neck1','Neck2'],[(lean+bob,0),(lean*.5,look),(-lean*1.6-bob*1.4,look)]):
            b=rest[n];turn=turn@Matrix.Rotation(yaw,3,'Z')@Matrix.Rotation(pitch,3,'Y')
            direction=turn@(b.tail_local-b.head_local).normalized()
            aim(pb[n],at,direction);at=at+direction*b.length
    def fight(t,moving):
        f=FIGHTER[name];pb=rig.pose.bones;tau=2*math.pi
        def turn(yaw=0,roll=0,pitch=0):return Matrix.Rotation(yaw,3,'Z')@Matrix.Rotation(roll,3,'X')@Matrix.Rotation(pitch,3,'Y')
        def orient(n,rotation,offset=Vector()):
            b=pb[n];head=b.head+offset;b.matrix=Matrix.Translation(head)@(rotation@b.bone.matrix_local.to_3x3()).to_4x4()
            bpy.context.view_layer.update()
        if moving:
            stance=math.cos(tau*(t-f['duty']/2))  # +1 at the left foot's mid-stance, -1 at the right's
            drop=-f['crouch']-f['bob']*math.cos(2*tau*(t-f['duty']/2))
            yaw=-f['twist']*math.cos(tau*t);roll=f['roll']*stance;sway=f['sway']*stance;lean=f['lean']
            shoulders=f['chest']*math.cos(tau*t);shrug=-f['shoulder']*stance
            swing=lambda side,lag=0:(-1 if side=='L' else 1)*f['swing']*math.cos(tau*(t-lag))
            low=max(0,math.cos(2*tau*(t-f['duty']/2)))**2  # 1 at each mid-stance, where the body sits lowest
            squash=f.get('squash',0)*low;belly=-f.get('belly',0)*math.cos(2*tau*(t-f['duty']/2-.1))
            flap=f['wing'][0]*math.sin(2*tau*t) if 'wing' in f else 0
        else:
            # Ready stance: knees soft, weight drifting foot to foot, chest breathing; Machop bobs on its toes.
            breath=math.sin(tau*t);drop=-f['crouch']*.8+.006*breath-f['bounce']*abs(math.sin(2*tau*t))
            yaw=.03*math.sin(tau*t+1);roll=.025*breath;sway=.012*breath;lean=.05;shoulders=-.02*math.sin(tau*t+1)
            shrug=-.02*breath
            swing=lambda side,lag=0:.07*math.sin(tau*(t-lag)+(0 if side=='L' else 1.3))
            squash=f.get('squash',0)*.3*(1+breath)/2;belly=f.get('belly',0)*.5*breath
            flap=f['wing'][1]*math.sin(tau*t) if 'wing' in f else 0
        hip=pb['Hip'];rest=hip.bone.matrix_local
        hip.matrix=Matrix.Translation(rest.translation+Vector((0,sway,drop)))@(turn(yaw,roll,lean)@rest.to_3x3()).to_4x4()
        bpy.context.view_layer.update()
        breathe=0 if moving else -.03*math.sin(tau*t)
        chest=turn(yaw+shoulders,roll*.3+shrug,lean*1.15+breathe);orient('Chest',chest,Vector((0,0,belly-squash*.5)))
        orient('Head',turn(.25*(yaw+shoulders),0,lean*.2),Vector((0,0,-squash*.5)))
        if 'tail' in f:
            # Against the hips' swing, lifting with the lean and lagging the bob.
            orient('Tail',turn(-f['tail']*yaw,0,lean*.6+(4*f['bob']*math.cos(2*tau*(t-f['duty']/2-.15)) if moving else .02*breath)))
        if 'wing' in f:
            for side,s in [('L',1),('R',-1)]:orient('Wing'+side,chest@Matrix.Rotation(s*flap,3,'X'))
        for side,s in [('L',1),('R',-1)]:
            ahead=(t+(0 if side=='L' else .5))%1
            fwd,up=foot_offset(ahead,f) if moving else (0,0)
            ankle=feet[side]
            solve_leg(rig,side,Vector((ankle.x+fwd+(f['reach'] if moving else 0),ankle.y*f['spread'],ankle.z+up)))
            pairs=[('Arm','Forearm',f['guard'],1,0)]+([('UpperArm','UpperForearm',f['upper'],.3,f['lag'])] if 'upper' in f else [])
            for upper,fore,(u0,f0),share,lag in pairs:
                a=swing(side,lag)*share;out=Vector((1,s,1))
                for n,d,bend in [(upper+side,u0,1),(fore+side,f0,1.3)]:
                    # Arms that hang pump fore and aft about the chest's side axis; arms held out, about its up axis.
                    swing_turn=Matrix.Rotation(-a*bend*s,3,'Z') if f.get('axis')=='Z' else Matrix.Rotation(-a*bend,3,'Y')
                    direction=chest@swing_turn@(Vector(d)*out).normalized()
                    aim(pb[n],pb[n].head.copy(),direction)
    def drift(t,moving):
        # Floating: one bob per loop; drifting, the body leans into the path and Haunter's hands trail and dart back.
        g=GHOST[name];pb=rig.pose.bones;tau=2*math.pi;wave=math.sin(tau*t)
        hip=pb['Hip'];rest=hip.bone.matrix_local;lean=g['lean']*(1+.25*math.cos(tau*t)) if moving else 0
        hip.matrix=Matrix.Translation(rest.translation+Vector((0,0,.13+.025*wave)))@(Matrix.Rotation(lean,3,'Y')@rest.to_3x3()).to_4x4()
        bpy.context.view_layer.update()
        def place(n,offset=Vector(),rotation=Matrix.Identity(3),scale=1):
            b=pb[n];b.matrix=Matrix.Translation(b.head+offset)@(rotation@b.bone.matrix_local.to_3x3()).to_4x4()@Matrix.Scale(scale,4)
            bpy.context.view_layer.update()
        if name=='gastly':
            place('Head',rotation=Matrix.Rotation(.035*wave,3,'Z')@Matrix.Rotation(lean,3,'Y'))
            # The gas ring streams back while drifting.
            back=Vector((-.05-.015*math.cos(tau*t),0,.01*wave)) if moving else Vector()
            place('Mist',back,Matrix.Rotation(lean,3,'Y')@Matrix.Rotation(.16*wave,3,'X'),1+.035*wave)
            return
        place('Head',rotation=Matrix.Rotation(.045*wave,3,'Z')@Matrix.Rotation(lean,3,'Y'))
        for side,s in [('L',1),('R',-1)]:
            if moving:
                # Trail back over most of the loop, then dart forward with a small rise.
                p=(t+(0 if side=='L' else .5))%1;a=g['trail']
                back=a-2*a*smooth(0,.7,p)+2*a*smooth(.7,1,p);up=.04*math.sin(math.pi*smooth(.7,1,p))
                place('Hand'+side,Vector((back-a*.6,0,up+.02*wave)),Matrix.Rotation(lean,3,'Y')@Matrix.Rotation(-s*.25*(.5-smooth(.7,1,p)),3,'Z'))
            else:
                place('Hand'+side,Vector((0,0,.035*math.sin(tau*t+s*.8))),Matrix.Rotation(s*.16*wave,3,'Y'))
    def glide(t):
        g=GLIDE;f=FIGHTER[name];pb=rig.pose.bones;tau=2*math.pi
        def turn(yaw=0,roll=0,pitch=0):return Matrix.Rotation(yaw,3,'Z')@Matrix.Rotation(roll,3,'X')@Matrix.Rotation(pitch,3,'Y')
        def orient(n,rotation):
            b=pb[n];b.matrix=Matrix.Translation(b.head.copy())@(rotation@b.bone.matrix_local.to_3x3()).to_4x4()
            bpy.context.view_layer.update()
        # Wings up at t = 0, down at 0.5: the body sinks on the upstroke and rises on the downstroke.
        flap=g['beat']*math.cos(tau*t);rise=g['hover']-g['heave']*math.cos(tau*t);lean=g['lean']+.04*math.sin(tau*t)
        hip=pb['Hip'];rest=hip.bone.matrix_local
        hip.matrix=Matrix.Translation(rest.translation+Vector((0,0,rise)))@(turn(0,0,lean)@rest.to_3x3()).to_4x4()
        bpy.context.view_layer.update()
        body=hip.matrix@rest.inverted()
        chest=turn(0,0,lean*1.05);orient('Chest',chest);orient('Head',turn(0,0,lean*.25))
        for side,s in [('L',1),('R',-1)]:
            orient('Wing'+side,chest@Matrix.Rotation(s*flap,3,'X'))
            # Legs ride the body, tucked a little back and up, paddling out of step.
            paddle=.02*math.sin(tau*t+(0 if side=='L' else math.pi))
            solve_leg(rig,side,body@(feet[side]+Vector((-.05+paddle,0,.05))))
            for n,d,bend in [('Arm'+side,f['guard'][0],1),('Forearm'+side,f['guard'][1],1.3)]:
                direction=chest@Matrix.Rotation(-.06*bend*math.sin(tau*t),3,'Y')@(Vector(d)*Vector((1,s,1))).normalized()
                aim(pb[n],pb[n].head.copy(),direction)
        orient('Tail',turn(.05*math.sin(tau*t-1.2),0,lean*.45+.08*math.sin(tau*t-1.2)))
    def pose(t,moving):
        for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
        bpy.context.view_layer.update()
        if name in SNAKES:slither(t,moving)
        elif name=='dragonite' and moving:glide(t)
        elif name in FIGHTERS:fight(t,moving)
        else:drift(t,moving)
        bpy.context.view_layer.update()
    seconds=FIGHTER[name]['frames']/30 if name in FIGHTERS and name!='dragonite' else RUN_SECONDS
    clip(rig,'idle',72,lambda t:pose(t,False));clip(rig,'run',round(seconds*30),lambda t:pose(t,True))
    for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
    out=ROOT/name/'blender/model.glb';out.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_draco_mesh_compression_enable=False)
    # Ground travel of one run loop per unit height: what formModels.runClipSpeed is (× height).
    travel=SNAKE[name]['wave'] if name in SNAKES else GHOST[name]['wave'] if name in GHOSTS else GLIDE['wave'] if name=='dragonite' else FIGHTER[name]['stride']/FIGHTER[name]['duty']
    report={'form':name,'bones':len(groups),'vertices':len(mesh.vertices),'triangles':sum(len(p.vertices)-2 for p in mesh.polygons),'runSeconds':seconds,'runCycles':1,'plantedSpeedPerHeight':travel/seconds,'credits':0}
    (out.parent/'rig.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else FORMS
    for name in args:build(name)
