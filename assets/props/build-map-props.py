"""S5–S7: seeded, vertex-coloured miniature scenery. Metres, Z up, one mesh/material.
Run blender -b --factory-startup --python-exit-code 1 -P assets/props/build-map-props.py
Then bun run assets:game <names from map-props.json>. No external source assets.
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
def stones(stage):
 low,high=PALETTES[stage]
 for i in range(3):
  m=model(f'{stage}-rock-{i+1}')
  if stage=='volcano':
   for x,y,h in [(-.3,0,.9),(.25,.05,1.4),(0,-.28,1.1)]:m.part('cone',(x,y,h/2),(.38,.38,h/2),low,6)
  elif stage=='desert' and i>0:
   for k in range(3 if i==1 else 5):
    h=1.5/(3 if i==1 else 5);r=.7*(1-k*.07)
    m.part('cone',(0,0,(k+.5)*h),(r,r,h*.51),low if k%2 else high,6 if i==2 else 8,.94)
  else:
   m.rock((0,0,.64),(.76,.72,.73),low)
   m.rock((-.08,.05,1.05),(.6,.55,.4),high)
   if stage=='forest':m.rock((-.08,.08,1.28),(.4,.38,.09),'475d39')
  m.finish()

def shrub(name,color,frost=False,flowers=False):
 m=model(name)
 if frost or 'dry' in name or 'tumble' in name:
  for k in range(7):
   a=k*2.399;end=(math.cos(a)*.4,math.sin(a)*.4,.3+.15*m.rng.random())
   m.branch((0,0,.04),end,.025,color,.3)
   m.branch(tuple(Vector(end)*.55),(end[0]*.9,end[1]*.9,end[2]+.15),.017,'d3dfe0' if frost else color,.2)
  if 'tumble' in name:
   for k in range(7):
    a=k*2.399;m.branch((math.cos(a)*.35,math.sin(a)*.35,.15),(math.cos(a+2)*.4,math.sin(a+2)*.4,.45),.018,color)
 else:
  for k in range(7):
   a=k*2.399;x,y=math.cos(a)*.28,math.sin(a)*.28
   m.rock((x,y,.24+m.rng.random()*.16),(.24,.22,.26),color)
   if flowers and k%3==0:m.rock((x,y,.6),(.055,.055,.025),'c9b9ad' if k else 'c7a4a1')
 m.finish()

def log(name,color):
 m=model(name);m.branch((-.7,0,.15),(.7,0,.2),.19,color,.85);m.branch((.2,0,.2),(.35,.28,.32),.07,color,.35)
 m.part('cone',(.71,0,.2),(.03,.13,.13),'a28c68') # end grain represented by attached pale knot
 m.finish()

def crystal(name,color,n=5):
 m=model(name)
 for i in range(n):
  a=i*2.399;r=.23 if i else 0;h=.35+.65*m.rng.random();x,y=math.cos(a)*r,math.sin(a)*r
  m.part('cone',(x,y,h*.38),(.12,.12,h*.38),color,5,.8);m.part('cone',(x,y,h*.86),(.096,.096,h*.1),color,5,0)
 m.finish()

def leaves(name,color):
 m=model(name)
 for i in range(8):
  a=i*2.399;r=m.rng.random()*.35;m.part('ball',(math.cos(a)*r,math.sin(a)*r,.018),(.09,.04,.015),color)
 m.finish()

def candles(name,lit):
 m=model(name)
 m.part('cone',(0,0,.035),(.34,.34,.035),'585361',8)
 for i,h in enumerate([.32,.47,.24]):
  x,y=math.cos(i*2.1)*.15,math.sin(i*2.1)*.15
  m.part('cone',(x,y,h/2),(.055,.055,h/2),'c1b59b',8,.9)
  m.branch((x,y,h),(x,y,h+.04),.009,'393339',.6)
  if lit:m.part('ball',(x,y,h+.06),(.025,.025,.06),'d6bc7c')
 m.finish()

def column(name):
 m=model(name)
 for z,r,h in [(.09,.73,.09),(.25,.56,.07),(1.8,.43,1.48),(3.35,.57,.08),(3.52,.68,.09)]:m.part('cone',(0,0,z),(r,r,h),'8b8497',10)
 m.finish()

def tomb(name,kind):
 m=model(name);m.part('box',(0,0,.1),(.65,.22,.1),'706a7c')
 if kind==1:
  m.part('box',(0,0,.75),(.17,.14,.65),'a29baa');m.part('box',(0,0,1.12),(.52,.14,.14),'a29baa')
 else:
  m.part('box',(0,0,.65),(.48,.14,.48),'a29baa')
  if kind==0:m.part('ball',(0,0,1.1),(.49,.15,.35),'a29baa')
  else:m.part('box',(0,0,1.18),(.53,.18,.08),'8f899a')
 m.part('box',(0,-.147,.77),(.19,.008,.13),'6f687a');m.finish()

def landmark(stage):
 m=model(stage+'-landmark');low,high=PALETTES[stage]
 # The centre stays a traversable, ankle-height plinth; silhouettes sit at the rear of the summon pad.
 m.part('cone',(0,0,.1),(.85,.85,.1),low,10)
 if stage=='forest':
  for k in range(6):
   a=k*math.tau/6;r=2.35;h=1.0+.6*m.rng.random();m.rock((math.cos(a)*r,math.sin(a)*r,h/2),(.28,.22,h/2),high)
   m.rock((math.cos(a)*r,math.sin(a)*r,h*.85),(.25,.2,.09),'4a643b')
  m.branch((0,0,.15),(0,0,.75),.045,'655039',.5)
  for x in [-.2,.15]:m.rock((x,0,.7),(.23,.16,.2),'6c8748')
 elif stage=='desert':
  for x in [-1.3,1.3]:m.part('cone',(x,.8,.8),(.37,.35,.8),low,6,.8)
  m.part('box',(0,.8,1.7),(1.7,.38,.22),high)
  m.part('cone',(0,.8,2.04),(.33,.16,.15),'b8a16b',10)
 elif stage=='coast':
  m.part('cone',(0,1.3,.65),(.7,.7,.65),low,8,.78)
  m.part('cone',(0,1.3,1.35),(.65,.65,.1),high,8)
  for x in [-.32,.32]:m.branch((x,1.3,1.4),(x,1.3,1.92),.065,low)
  m.part('cone',(0,1.3,1.94),(.52,.52,.12),high,8,.4)
 elif stage=='glacier':
  m.part('cone',(0,1.4,.8),(.46,.4,.8),'9db4c0',5,.7)
  m.part('cone',(0,1.4,1.85),(.322,.28,.25),'c8d8db',5,0)
  for x in [-.7,.7]:m.part('cone',(x,1.4,.5),(.2,.18,.5),'8fa8b9',5,.1)
 elif stage=='volcano':
  for k in range(7):
   a=k*math.tau/7;h=.6+.7*m.rng.random();m.part('cone',(math.cos(a)*1.5,math.sin(a)*1.5,h/2),(.25,.25,h/2),low,6)
  m.part('cone',(0,0,.19),(.6,.6,.025),'582f28',12)
 else:
  m.part('box',(0,1.25,.3),(1.0,.5,.3),low);m.part('box',(0,1.25,.66),(1.1,.59,.08),high)
  for x in [-1.4,1.4]:m.part('cone',(x,1.25,.8),(.15,.15,.8),low,6);m.part('ball',(x,1.25,1.68),(.14,.14,.16),'b6ac95')
 m.finish()

def main():
 print('Blender',bpy.app.version_string);bpy.ops.wm.read_factory_settings(use_empty=True)
 for stage in PALETTES:
  stones(stage);landmark(stage)
  # A low stage-material plinth surrounds the existing station without changing its interactions.
  m=model(stage+'-station');m.part('cone',(0,0,.08),(1.25,1.25,.08),PALETTES[stage][0],10);m.part('cone',(0,0,.17),(1.08,1.08,.03),PALETTES[stage][1],10);m.finish()
 for i in range(3):
  m=model(f'forest-mushroom-{i+1}');h=.18+i*.035;m.part('cone',(0,0,h/2),(.035,.035,h/2),'b8ad8e',6,.8);m.part('cone',(0,0,h),(.14,.14,.045),['9d8960','a5a793','82735a'][i],8,.25);m.finish()
 leaves('forest-leaves','8e794c');log('forest-log','564837');shrub('forest-bush','47633c')
 shrub('desert-dry-bush','9c8b60');shrub('desert-tumbleweed','a5946c');log('coast-driftwood','8c8270')
 m=model('desert-cactus');m.part('cone',(0,0,.2),(.16,.16,.2),'668754',10,.7);m.part('ball',(0,0,.4),(.12,.12,.08),'7c965e');m.finish()
 for name,col in [('desert-pebbles','9c8973'),('tower-rubble','817b8b'),('glacier-snowdrift','cdd9df')]:
  m=model(name)
  for i in range(5):m.rock((m.rng.uniform(-.3,.3),m.rng.uniform(-.3,.3),.07),(.15,.12,.09),col)
  m.finish()
 m=model('desert-ribs');m.branch((-.45,0,.05),(.45,0,.05),.045,'c6bca2')
 for x in [-.3,-.1,.1,.3]:
  for sign in [-1,1]:m.branch((x,0,.05),(x,sign*.25,.3),.028,'d0c4a8');m.branch((x,sign*.25,.3),(x,sign*.32,.1),.028,'d0c4a8')
 m.finish()
 m=model('desert-skull');m.rock((0,0,.12),(.2,.25,.15),'d0c5ae')
 for x in [-.08,.08]:m.part('ball',(x,-.21,.14),(.045,.04,.045),'635c51')
 m.finish()
 for i in range(2):shrub(f'coast-shrub-{i+1}','4b7846',flowers=True)
 m=model('coast-shell');m.part('ball',(0,0,.04),(.12,.15,.045),'b4aa97')
 for i in range(5):m.branch((0,-.11,.045),((i-2)*.04,.1,.055),.008,'c9bc9f')
 m.finish();shrub('coast-seagrass','6c7951')
 shrub('glacier-frost-shrub','8b9498',frost=True)
 for i in range(2):crystal(f'glacier-icicles-{i+1}','a8becb',5+i)
 crystal('glacier-crystals','aabac4',4)
 for i in range(2):
  m=model(f'volcano-dead-tree-{i+1}');m.branch((0,0,0),(0,0,2),.18,'4c4547',.45)
  for k in range(4):
   a=k*2.399;m.branch((0,0,1+k*.13),(math.cos(a)*.65,math.sin(a)*.65,1.7+k*.18),.07,'51484a',.3)
  m.finish()
 crystal('volcano-obsidian','48434d',4);crystal('volcano-sulphur','aaa16b',4)
 m=model('volcano-vent');m.part('cone',(0,0,.14),(.36,.36,.14),'595055',8,.5);m.part('cone',(0,0,.28),(.16,.16,.015),'6e4435',8);m.finish()
 candles('tower-candles',True);candles('tower-candles-out',False);column('tower-column')
 for i in range(3):tomb(f'tower-tomb-{i+1}',i)
 leaves('tower-petals','c5bfa9')
 m=model('tower-incense');m.part('cone',(0,0,.16),(.25,.25,.16),'817c70',8,.8);m.part('cone',(0,0,.35),(.23,.23,.06),'8f8877',8,.5)
 for x in [-.08,.08]:m.branch((x,0,.4),(x,.03,.65),.012,'837257')
 m.finish()
 (ROOT/'map-props.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print('RESULT',json.dumps({'assets':len(manifest),'triangles':sum(x['triangles'] for x in manifest.values())}))
main()
