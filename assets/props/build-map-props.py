"""S5–S7: seeded, vertex-coloured miniature scenery. Metres, Z up, one mesh/material.
Run blender -b --factory-startup --python-exit-code 1 -P assets/props/build-map-props.py
Then bun run assets:game <names from map-props.json>. No external source assets.
Rocks, shrubs, the round tree, tombs, mushrooms, bones, shells, driftwood and the desert/coast/glacier/tower
landmarks come from Tripo (compose-tripo-props.py); this script keeps the pieces whose shape or vertex colours the view relies on.
"""
import bpy, bmesh, math, random, json, hashlib
from mathutils import Vector, Matrix
from pathlib import Path
ROOT = Path(__file__).resolve().parent
PALETTES = {
 'forest': ('536653','79836b'), 'desert': ('b68a60','d4af7d'),
 'coast': ('6e7780','969c9e'), 'glacier': ('596575','cad9df'),
 'volcano': ('3c3b42','625d61'), 'tower': ('6d687a','9b94a6')}
manifest = {}
class Model:
 def __init__(self,name,seed):
  self.name=name; self.seed=seed; self.rng=random.Random(seed); self.bm=bmesh.new(); self.col=self.bm.loops.layers.color.new('Col')
 def part(self,kind,center,size,color,sides=8,top=None,detail=1):
  b=bmesh.new()
  if kind=='ball': bmesh.ops.create_icosphere(b,subdivisions=detail,radius=1)
  elif kind=='box': bmesh.ops.create_cube(b,size=2)
  else: bmesh.ops.create_cone(b,cap_ends=True,cap_tris=False,segments=sides,radius1=1,radius2=1 if top is None else top,depth=2)
  made={v:self.bm.verts.new(Vector(center)+Vector((v.co.x*size[0],v.co.y*size[1],v.co.z*size[2]))) for v in b.verts}
  rgb=[int(color[i:i+2],16)/255 for i in (0,2,4)]
  for f in b.faces:
   face=self.bm.faces.new([made[v] for v in f.verts]); shade=self.rng.uniform(.94,1.04)
   for l in face.loops: l[self.col]=(*(min(1,c*shade) for c in rgb),1)
  b.free();return list(made.values())
 def branch(self,a,b,r,color,end=.6):
  a,b=Vector(a),Vector(b);v=self.part('cone',(0,0,0),(r,r,(b-a).length/2),color,6,end)
  q=Vector((0,0,1)).rotation_difference((b-a).normalized())
  for p in v:p.co=q@p.co+(a+b)/2
 def rings(self,rings,colors,shade=0.0,caps=None):
  """Closed solid through same-sized vertex rings (a one-point ring is an apex). colors[k] paints
  band k and the caps (or caps=(bottom, top)); shade>0 alternates sectors so slabs, ribs and facets read."""
  rgb=lambda c:[int(c[i:i+2],16)/255 for i in (0,2,4)]
  vs=[[self.bm.verts.new(Vector(p)) for p in r] for r in rings]
  def paint(face,color,k):
   tone=self.rng.uniform(.95,1.04)*(1-shade*(k%2))
   for l in face.loops:l[self.col]=(*(min(1,c*tone) for c in rgb(color)),1)
  n=max(len(r) for r in vs)
  caps=caps or (colors[0],colors[-1])
  if len(vs[0])>1:paint(self.bm.faces.new(list(reversed(vs[0]))),caps[0],0)
  for b,(lo,hi) in enumerate(zip(vs,vs[1:])):
   for i in range(n):
    j=(i+1)%n
    if len(hi)==1:f=self.bm.faces.new((lo[i],lo[j],hi[0]))
    elif len(lo)==1:f=self.bm.faces.new((lo[0],hi[j],hi[i]))
    else:f=self.bm.faces.new((lo[i],lo[j],hi[j],hi[i]))
    paint(f,colors[min(b,len(colors)-1)],i)
  if len(vs[-1])>1:paint(self.bm.faces.new(vs[-1]),caps[1],0)
 def lathe(self,center,profile,colors,sides=10,jitter=0.0,ribs=0.0,phase=0.0,shade=None):
  """Turned solid from (radius, z) pairs; jitter is per spoke so bevels stay crisp, ribs alternate spokes;
  shade alternates the sectors' tone (defaults to a light one only on ribbed solids)."""
  spoke=[1+self.rng.uniform(-jitter,jitter) for _ in range(sides)]
  cx,cy,cz=center;out=[]
  for r,z in profile:
   if r==0:out.append([(cx,cy,cz+z)]);continue
   ring=[]
   for i in range(sides):
    a=phase+i*math.tau/sides;k=r*spoke[i]*(1-ribs*(i%2))
    ring.append((cx+math.cos(a)*k,cy+math.sin(a)*k,cz+z))
   out.append(ring)
  self.rings(out,colors,shade=(.1 if ribs else 0) if shade is None else shade)
 def shard(self,center,radius,height,colors,sides=5,lean=(0,0),point=False,tilt=.35):
  """A jittered prism that narrows and leans; its top is either a point or a slanted broken face."""
  cx,cy,cz=center;spin=self.rng.uniform(0,math.tau)
  base=[(radius*self.rng.uniform(.8,1.15),spin+i*math.tau/sides+self.rng.uniform(-.25,.25)) for i in range(sides)]
  cut=self.rng.uniform(0,math.tau);slope=self.rng.uniform(.4,1)*tilt*height
  def ring(t,scale,z):
   return [(cx+lean[0]*t+math.cos(a)*r*scale,cy+lean[1]*t+math.sin(a)*r*scale,
            cz+z+(0 if t==0 else slope*t*math.cos(a-cut)*r/radius*.5)) for r,a in base]
  rings=[ring(0,1,0),ring(.55,.82,height*.55)]
  rings.append([(cx+lean[0],cy+lean[1],cz+height)] if point else ring(1,.58,height*.9))
  self.rings(rings,colors,shade=.12)
 def tube(self,points,radii,bark,end,sides=7,jitter=.08):
  """Horizontal-ish bark tube through points, closed by pale end-grain caps."""
  spoke=[1+self.rng.uniform(-jitter,jitter) for _ in range(sides)]
  rings=[]
  for k,(p,r) in enumerate(zip(points,radii)):
   p=Vector(p);d=(Vector(points[min(k+1,len(points)-1)])-Vector(points[max(k-1,0)])).normalized()
   u=d.cross(Vector((0,0,1)));u=(u if u.length>1e-3 else d.cross(Vector((0,1,0)))).normalized();w=d.cross(u)
   rings.append([tuple(p+(u*math.cos(i*math.tau/sides)+w*math.sin(i*math.tau/sides))*r*spoke[i]) for i in range(sides)])
  self.rings(rings,[bark],caps=(end,end))
 def rock(self,center,size,color):
  v=self.part('ball',center,size,color,detail=2)
  for p in v:
   p.co=Vector(center)+(p.co-Vector(center))*self.rng.uniform(.9,1.1)
 def finish(self):
  bmesh.ops.recalc_face_normals(self.bm,faces=list(self.bm.faces));bmesh.ops.triangulate(self.bm,faces=list(self.bm.faces))
  # Base at zero, metres preserved. Closed component meshes, no loose vertices/degenerate triangles.
  bottom=min(v.co.z for v in self.bm.verts)
  for v in self.bm.verts:v.co.z-=bottom
  assert all(f.calc_area()>1e-9 for f in self.bm.faces),self.name
  assert all(e.is_manifold for e in self.bm.edges),self.name
  mesh=bpy.data.meshes.new(self.name);self.bm.to_mesh(mesh);self.bm.free()
  obj=bpy.data.objects.new(self.name,mesh);bpy.context.collection.objects.link(obj)
  mat=bpy.data.materials.new(self.name);mat.use_nodes=True;mat.use_backface_culling=True
  bsdf=mat.node_tree.nodes.get('Principled BSDF');attr=mat.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='Col';mat.node_tree.links.new(attr.outputs['Color'],bsdf.inputs['Base Color']);mesh.materials.append(mat)
  out=ROOT/self.name/'blender/model.glb';out.parent.mkdir(parents=True,exist_ok=True)
  bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_vertex_color='MATERIAL')
  record={'generator':'assets/props/build-map-props.py','seed':self.seed,'source':'Original scripted geometry; no external assets','triangles':len(mesh.polygons),'materials':1,'vertexColors':True,'units':'metres','sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'tripoCredits':0}
  (out.parent.parent/'provenance.json').write_text(json.dumps(record,indent=2)+'\n');manifest[self.name]=record
  print(self.name,len(mesh.polygons))
  bpy.data.objects.remove(obj,do_unlink=True)

def model(name):return Model(name, int.from_bytes(hashlib.sha256(name.encode()).digest()[:4],'little'))

def shrub(name,color,frost=False,flowers=False):
 m=model(name)
 if frost or 'dry' in name:
  for k in range(7):
   a=k*2.399;end=(math.cos(a)*.4,math.sin(a)*.4,.3+.15*m.rng.random())
   m.branch((0,0,.04),end,.025,color,.3)
   m.branch(tuple(Vector(end)*.55),(end[0]*.9,end[1]*.9,end[2]+.15),.017,'d3dfe0' if frost else color,.2)
 else:
  for k in range(7):
   a=k*2.399;x,y=math.cos(a)*.28,math.sin(a)*.28
   m.rock((x,y,.24+m.rng.random()*.16),(.24,.22,.26),color)
   if flowers and k%3==0:m.rock((x,y,.6),(.055,.055,.025),'c9b9ad' if k else 'c7a4a1')
 m.finish()


def tumbleweed():
 # A wiry ball: crooked twig loops wound round one centre, thick near the core and thin at the skin.
 m=model('desert-tumbleweed');r,c=.34,Vector((0,0,.34))
 for k in range(11):
  axis=Vector((m.rng.uniform(-1,1),m.rng.uniform(-1,1),m.rng.uniform(-1,1))).normalized()
  u=axis.orthogonal().normalized();w=axis.cross(u);start=m.rng.uniform(0,math.tau);pts=[]
  for i in range(9):
   a=start+i*math.tau/8*.85;k_r=r*m.rng.uniform(.8,1.05)
   pts.append(c+(u*math.cos(a)+w*math.sin(a))*k_r)
  for a,b in zip(pts,pts[1:]):m.branch(tuple(a),tuple(b),.016,'a5946c' if k%3 else '8a7a58',.8)
 for k in range(6):
  d=Vector((m.rng.uniform(-1,1),m.rng.uniform(-1,1),m.rng.uniform(-.6,1))).normalized()
  m.branch(tuple(c),tuple(c+d*r*.9),.022,'7d6d4c',.5)
 m.finish()


def leaves(name,color):
 m=model(name)
 for i in range(8):
  a=i*2.399;r=m.rng.random()*.35;m.part('ball',(math.cos(a)*r,math.sin(a)*r,.018),(.09,.04,.015),color)
 m.finish()


# Station trim per stage: moss, sun-gold inlay, shell-white, frost, cooled iron, and the tower's brass.
TRIMS={'forest':'61804a','desert':'c99e57','coast':'d9d1bd','glacier':'e3ecf0','volcano':'6c4a40','tower':'b9a56c'}
def station(stage):
 # Same reach (r 1.25) and height (0.2) as before: a stepped dais of alternating flagstones, an inset trim
 # band, and eight low trim-coloured step stones around the foot.
 low,high=PALETTES[stage];m=model(stage+'-station');trim=TRIMS[stage]
 m.lathe((0,0,0),[(1.18,0),(1.18,.07),(1.12,.11),(1.04,.11),(1.01,.16),(.95,.2),(.86,.2),(.83,.17),(.76,.17),(.73,.2),(0,.2)],
         [low,high,high,low,high,high,trim,trim,high,high],sides=16,shade=.08)
 for k in range(8):
  a=k*math.tau/8+math.pi/8;x,y=math.cos(a)*1.17,math.sin(a)*1.17
  m.shard((x,y,0),.1,.09,[low,trim,trim],sides=5,tilt=.3)
 m.finish()

def forest_landmark():
 m=model('forest-landmark');low,high=PALETTES['forest']
 # The centre stays a traversable, ankle-height flagstone plinth; six standing stones keep the radius
 # and 60-degree spacing forestStone's glowing seams are drawn on.
 m.lathe((0,0,0),[(1.0,0),(1.0,.11),(.9,.2),(.78,.2),(.74,.17),(0,.17)],[low,high,high,low,high],sides=12)
 for k in range(6):
  a=k*math.tau/6;r=2.35;h=1.0+.5*m.rng.random();x,y=math.cos(a)*r,math.sin(a)*r
  m.shard((x,y,0),.3,h,[high,high,'4a643b'],sides=6,lean=(m.rng.uniform(-.08,.08),m.rng.uniform(-.08,.08)))
  m.shard((x+math.cos(a+1.3)*.32,y+math.sin(a+1.3)*.32,0),.13,.2+.1*m.rng.random(),[low,low,'4a643b'],sides=5)
 m.branch((0,0,.12),(0,.04,.78),.045,'655039',.5)
 for x,y,z,s in [(-.17,0,.74,.22),(.15,.06,.8,.2),(0,-.05,.95,.17)]:
  m.part('ball',(x,y,z),(s,s*.8,s*.75),'6c8748' if x else '5d7a3e')
 m.finish()

def volcano_landmark():
 m=model('volcano-landmark');low,high=PALETTES['volcano']
 # Stepped basalt dais with a sunken basin; the basin's red faces are what animateVolcanoAltar melts.
 m.lathe((0,0,0),[(1.25,0),(1.25,.09),(1.16,.15),(.98,.15),(.98,.24),(.9,.3),(.68,.3),(.62,.24),(0,.24)],
         [low,high,'4a474e',low,high,'4a474e','2f2c31','8a2a12'],sides=14,jitter=.03)
 for k in range(7):
  a=k*math.tau/7+m.rng.uniform(-.15,.15);r=1.5+m.rng.uniform(-.08,.08);h=.6+.62*m.rng.random()
  m.shard((math.cos(a)*r,math.sin(a)*r,0),.25,h,[low,low,high],sides=6,lean=(math.cos(a)*.08,math.sin(a)*.08),tilt=.6)
 m.finish()

def crystal(name,base,tip,n,tall=1.0,point=True):
 m=model(name)
 for i in range(n):
  a=i*2.399+m.rng.uniform(-.3,.3);r=0 if i==0 else .14+.12*m.rng.random();x,y=math.cos(a)*r,math.sin(a)*r
  h=tall*(1 if i==0 else .4+.45*m.rng.random())
  m.shard((x,y,0),.1+.04*m.rng.random(),h,[base,tip,tip],sides=5+i%2,lean=(x*.9,y*.9),point=point or i%2==0)
 m.finish()

def icicles(name,n):
 m=model(name)
 m.lathe((0,0,0),[(.42,0),(.4,.06),(.3,.1),(0,.11)],['b4c4cf','cdd9df','e1eaef'],sides=9,jitter=.15)
 for i in range(n):
  a=i*2.399;r=0 if i==0 else .12+.16*m.rng.random();x,y=math.cos(a)*r,math.sin(a)*r
  m.shard((x,y,.04),.11+.05*m.rng.random(),(1.0 if i==0 else .35+.5*m.rng.random()),['8fa8b9','a8becb','d2e0e8'],
          sides=5,lean=(x*.7,y*.7),point=True)
 m.finish()

def log(name,bark,end,moss=None):
 m=model(name)
 pts=[(-.72,0,.17),(-.35,.03,.19),(0,0,.2),(.35,-.03,.2),(.72,0,.19)]
 m.tube(pts,[.17,.19,.18,.19,.16],bark,end,sides=8)
 m.branch((.15,0,.25),(.3,.3,.4),.06,bark,.4)
 if moss:
  for x in (-.4,.25):m.part('ball',(x,0,.35),(.16,.13,.05),moss)
 m.finish()

def seagrass(name):
 m=model(name)
 for k in range(9):
  a=k*2.399;r=.06+.12*m.rng.random();x,y=math.cos(a)*r,math.sin(a)*r;h=.25+.3*m.rng.random()
  m.shard((x,y,0),.035,h,['4f6a3f','6c7951','8d9a5c'],sides=3,lean=(x*1.4,y*1.4),point=True,tilt=0)
 m.finish()

def snowdrift(name):
 m=model(name)
 for x,y,s,h in [(0,0,.42,.16),(.2,.12,.22,.13),(-.22,-.08,.2,.1)]:
  m.lathe((x,y,0),[(s,0),(s*.92,h*.4),(s*.6,h*.85),(0,h)],['b4c4cf','cdd9df','e4ecf0'],sides=9,jitter=.18)
 m.finish()

def pebbles(name,low,high):
 m=model(name)
 for i in range(5):
  m.shard((m.rng.uniform(-.3,.3),m.rng.uniform(-.3,.3),0),.11+.05*m.rng.random(),.08+.07*m.rng.random(),[low,high,high],sides=5,tilt=.8)
 m.finish()

def cactus():
 m=model('desert-cactus');body,rib='668754','7c965e'
 # A ribbed saguaro: ten alternating spokes, two arms, and one pale bloom.
 m.lathe((0,0,0),[(.13,0),(.14,.06),(.14,.36),(.11,.43),(.05,.47),(0,.475)],[body,rib,rib,rib,rib],sides=10,ribs=.18)
 for side,z0,z1 in [(1,.17,.36),(-1,.24,.39)]:
  m.branch((0,0,z0),(side*.2,0,z0+.03),.055,body,.9)
  m.lathe((side*.21,0,z0-.03),[(.065,0),(.065,z1-z0),(.04,z1-z0+.04),(0,z1-z0+.055)],[body,rib,rib],sides=8,ribs=.15)
 m.part('ball',(0,0,.475),(.035,.035,.02),'d9b4a0')
 m.finish()

def dead_tree(i):
 m=model(f'volcano-dead-tree-{i+1}')
 bend=(m.rng.uniform(-.25,.25),m.rng.uniform(-.25,.25))
 m.branch((0,0,0),(bend[0]*.5,bend[1]*.5,1.1),.19,'4c4547',.7)
 m.branch((bend[0]*.5,bend[1]*.5,1.1),(bend[0],bend[1],2+.3*m.rng.random()),.13,'4c4547',.4)
 for k in range(3+i+m.rng.randrange(2)):
  a=m.rng.uniform(0,math.tau);z=.8+m.rng.uniform(0,1);reach=.4+.4*m.rng.random()
  root=(bend[0]*z/2,bend[1]*z/2,z);tip=(root[0]+math.cos(a)*reach,root[1]+math.sin(a)*reach,z+.3+.4*m.rng.random())
  m.branch(root,tip,.06,'51484a',.4)
  m.branch(tip,(tip[0]+math.cos(a+.8)*.2,tip[1]+math.sin(a+.8)*.2,tip[2]+.18),.025,'51484a',.3)
 for k in range(3):
  a=k*math.tau/3+m.rng.uniform(0,1);m.branch((0,0,.12),(math.cos(a)*.38,math.sin(a)*.38,0.01),.07,'4c4547',.3)
 m.finish()

def vent():
 m=model('volcano-vent')
 m.lathe((0,0,0),[(.4,0),(.38,.1),(.28,.26),(.22,.29),(.16,.22),(0,.18)],['595055','6a6267','6a6267','6e4435','5a2f24'],sides=9,jitter=.15)
 for k in range(4):
  a=k*math.tau/4+m.rng.uniform(0,.8)
  m.shard((math.cos(a)*.34,math.sin(a)*.34,0),.08,.12+.12*m.rng.random(),['3c3b42','4a474e','625d61'],sides=5,tilt=.8)
 m.finish()

def candles(name):
 m=model(name)
 m.lathe((0,0,0),[(.34,0),(.36,.03),(.3,.06),(.26,.05),(0,.05)],['585361','6c6676','6c6676','4b4652'],sides=10)
 for i,h in enumerate([.32,.47,.24]):
  x,y=math.cos(i*2.1)*.15,math.sin(i*2.1)*.15
  # Wax pools at the foot and a sunken, dripping lip; the flame stays the top 12% the shader lights.
  m.lathe((x,y,.04),[(.075,0),(.06,.02),(.055,.04),(.055,h-.06),(.06,h-.04),(.045,h-.02),(.03,h-.03),(0,h-.03)],
          ['d2c6aa','c1b59b','c1b59b','c1b59b','d2c6aa','b3a78e','b3a78e'],sides=8,jitter=.04)
  m.branch((x,y,h),(x,y,h+.04),.009,'393339',.6)
  m.part('ball',(x,y,h+.06),(.025,.025,.06),'d6bc7c')
 m.finish()

def column():
 m=model('tower-column');stone,shade='8b8497','7a7486'
 m.lathe((0,0,0),[(.73,0),(.73,.16),(.66,.2),(.62,.26),(.56,.3),(.5,.36),(0,.36)],[shade,stone,stone,stone,stone,stone],sides=12)
 m.lathe((0,0,.34),[(.47,0),(.45,1.4),(.42,2.9),(0,2.9)],[stone,stone,stone],sides=16,ribs=.08)
 m.lathe((0,0,3.2),[(.46,0),(.52,.1),(.6,.18),(.68,.22),(.73,.25),(.73,.41),(0,.41)],[stone,stone,stone,stone,shade,stone],sides=12)
 m.finish()

def incense():
 m=model('tower-incense')
 m.lathe((0,0,0),[(.2,0),(.24,.04),(.18,.1),(.22,.18),(.29,.28),(.3,.34),(.25,.37),(.2,.32),(0,.32)],
         ['6f6a5f','817c70','817c70','8f8877','9a927f','8f8877','5a5248','4a443c'],sides=10)
 for x in [-.08,.08]:m.branch((x,0,.3),(x,.03,.62),.012,'837257')
 m.finish()

def main():
 print('Blender',bpy.app.version_string);bpy.ops.wm.read_factory_settings(use_empty=True)
 for stage in PALETTES:station(stage)
 forest_landmark();volcano_landmark()
 leaves('forest-leaves','8e794c');log('forest-log','564837','a28c68',moss='5f7a45')
 shrub('desert-dry-bush','9c8b60');tumbleweed()
 cactus();pebbles('desert-pebbles','8c7a65','a8957d');pebbles('tower-rubble','6f6a7a','8b8597');snowdrift('glacier-snowdrift')
 seagrass('coast-seagrass')
 shrub('glacier-frost-shrub','8b9498',frost=True)
 icicles('glacier-icicles-1',5);icicles('glacier-icicles-2',6)
 crystal('glacier-crystals','8fa8b9','c9dae3',5)
 for i in range(2):dead_tree(i)
 crystal('volcano-obsidian','2e2a33','4d4656',5,point=False);vent()
 candles('tower-candles');column()
 leaves('tower-petals','c5bfa9');incense()
 (ROOT/'map-props.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print('RESULT',json.dumps({'assets':len(manifest),'triangles':sum(x['triangles'] for x in manifest.values())}))
main()
