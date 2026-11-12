"""Bake planted idle feet on the eight prepared Tripo bipeds (Blender 5.2).

In prepare-game-models.py, load once with runpy.run_path(str(ASSETS /
"characters/idle-bipeds.py"))["pin_idle_feet"], then call pin_idle_feet()
at the END of each biped's FIXES, after symmetrise/open_arms/add_tail.
Applies to charmander, charmeleon, charizard, squirtle, wartortle, blastoise,
pikachu and raichu; the caller selects these, never the quadrupeds.

Works in the existing scene, +X forward, +Y left, +Z up. No import/export,
rest/weight edits, new bones, constraints, actions or FPS changes. Only idle's
Hip location and Thigh/Calf/Foot/ToeBase transforms are baked. Other curves,
slots, NLA strips and the exact action endpoints are retained.

Feet start at their bind ankles/orientations, on a common bind-sole floor.
The hip keeps its rotation and horizontal motion; its height is clamped to
both legs' reachable intervals. Evaluated skin, including Calf/Thigh weights,
then drives small ankle translations and foot tilts to hold each sole's XY
centre, lowest point and best-fit plane. This does not rigidify soft skin:
heel/toe residuals are returned for inspection, not hidden by a body lift.

Integration was checked for all eight forms on 2026-11-07.
Recheck contact, subframes, knees, full-body penetration and blends whenever
source geometry, weights, rest pose or clips change.
Finite solver convergence is not visual approval or a guarantee about blended
clips. An infeasible reach or nonconverging surface fit raises before keys are
changed. The original upper-body loop seam is not rewritten here.
"""

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector


def _absolute(bone, head, turn):
    """Same rest-direction two-bone construction as run-bipeds.py:Leg.solve."""
    bone.matrix = Matrix.Translation(head) @ (turn @ bone.bone.matrix_local.to_3x3()).to_4x4()
    bpy.context.view_layer.update()


class _Leg:
    def __init__(self, rig, side, points, indices, floor, height):
        self.bones = [rig.pose.bones[f"{side}_{part}"] for part in ("Thigh", "Calf", "Foot", "ToeBase")]
        self.hip, self.knee, self.ankle, self.toe = [b.bone.head_local.copy() for b in self.bones]
        self.l1 = (self.knee - self.hip).length
        self.l2 = (self.ankle - self.knee).length
        self.minimum = abs(self.l1 - self.l2) + height * 1e-5
        self.maximum = (self.l1 + self.l2) * 0.995
        if self.minimum >= self.maximum:
            raise RuntimeError(f"idle {side}: degenerate leg lengths")
        self.indices = indices
        self.bind = points[indices].copy()
        self.ground_shift = floor - self.bind[:, 2].min()
        self.bind[:, 2] += self.ground_shift
        self.target = self.ankle + Vector((0, 0, self.ground_shift))
        self.centre = self.bind.mean(axis=0)
        # Fit height changes over the same vertices, so a sculpted/clawed sole
        # need not be geometrically flat to keep its bind contact plane.
        xy = self.bind[:, :2] - self.centre[:2]
        design = np.column_stack((xy, np.ones(len(xy))))
        if np.linalg.matrix_rank(design) != 3:
            raise RuntimeError(f"idle {side}: sole has no two-dimensional support patch")
        self.plane = np.linalg.pinv(design)
        self.span = np.ptp(self.bind[:, :2], axis=0)
        self.heel = self.bind[:, 0] <= self.centre[0]
        self.front = ~self.heel

    def solve(self, ankle, tilt):
        thigh, calf, foot, toe = self.bones
        hip = thigh.head.copy()
        reach = ankle - hip
        distance = reach.length
        if not self.minimum * (1 - 1e-5) <= distance <= self.maximum * (1 + 1e-5):
            raise RuntimeError(f"idle {thigh.name}: unreachable ankle, distance {distance:.7f}")
        axis = reach / distance
        bend = Vector((-axis.z, 0, axis.x))
        bend = (bend - axis * axis.dot(bend)).normalized()
        along = (distance**2 + self.l1**2 - self.l2**2) / (2 * distance)
        knee = hip + axis * along + bend * math.sqrt(max(0, self.l1**2 - along**2))
        _absolute(thigh, hip, (self.knee - self.hip).rotation_difference(knee - hip).to_matrix())
        _absolute(calf, knee, (self.ankle - self.knee).rotation_difference(ankle - knee).to_matrix())
        turn = Matrix.Rotation(float(tilt[0]), 3, "X") @ Matrix.Rotation(float(tilt[1]), 3, "Y")
        _absolute(foot, ankle, turn)
        # ToeBase's head is not necessarily Foot.tail in the imported rig.
        _absolute(toe, ankle + turn @ (self.toe - self.ankle), turn)

    def residual(self, points):
        sole = points[self.indices]
        slopes = (self.plane @ (sole[:, 2] - self.bind[:, 2]))[:2]
        centre = sole.mean(axis=0)
        return np.array((centre[0] - self.centre[0], centre[1] - self.centre[1],
                         sole[:, 2].min() - self.bind[:, 2].min(), *(slopes * self.span)))


def _skin_points(mesh, rig):
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    surface = evaluated.to_mesh()
    try:
        if len(surface.vertices) != len(mesh.data.vertices):
            raise RuntimeError("idle: evaluated mesh changed vertex count; sole indices are invalid")
        transform = rig.matrix_world.inverted() @ evaluated.matrix_world
        return np.array([tuple(transform @ v.co) for v in surface.vertices])
    finally:
        evaluated.to_mesh_clear()


def _hip_shift(legs, ankles):
    """Intersect both vertical reach intervals, staying above the ankles."""
    lower, upper = -math.inf, math.inf
    for leg, ankle in zip(legs, ankles):
        head = leg.bones[0].head
        horizontal = (head.x - ankle.x)**2 + (head.y - ankle.y)**2
        if horizontal >= leg.maximum**2:
            raise RuntimeError(f"idle {leg.bones[0].name}: planted ankle is horizontally unreachable")
        base = ankle.z - head.z
        lower = max(lower, base + math.sqrt(max(0, leg.minimum**2 - horizontal)))
        upper = min(upper, base + math.sqrt(leg.maximum**2 - horizontal))
    if lower > upper:
        raise RuntimeError("idle: the two legs have no common reachable hip height")
    return min(upper, max(lower, 0.0))


def pin_idle_feet():
    """Modify the current prepared biped's idle in place; return contact diagnostics.

    All distances in the returned dict use armature units. Run exactly once per
    fresh prepare import. Sampling is one scene frame apart (24 fps in prepare),
    including exact fractional action endpoints; it never rounds the duration.
    """
    scene = bpy.context.scene
    rigs = [o for o in scene.objects if o.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"idle: expected one biped rig, found {len(rigs)}")
    rig = rigs[0]
    meshes = [o for o in scene.objects if o.type == "MESH" and
              any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
    if len(meshes) != 1:
        raise RuntimeError(f"idle: expected one skinned body, found {len(meshes)}")
    mesh = meshes[0]
    # Vertex IDs must survive evaluation; these assets have only an Armature modifier.
    if any(m.type != "ARMATURE" for m in mesh.modifiers if m.show_viewport):
        raise RuntimeError("idle: bake before adding topology or surface modifiers")
    action = bpy.data.actions.get("idle")
    if action is None or len(action.slots) != 1:
        raise RuntimeError("idle: expected the prepared single-slot idle action")
    bags = [bag for layer in action.layers for strip in layer.strips for bag in strip.channelbags
            if bag.slot_handle == action.slots[0].handle]
    if len(bags) != 1:
        raise RuntimeError("idle: expected one idle channelbag")
    bag = bags[0]
    names = ["Hip"] + [f"{s}_{p}" for s in "LR" for p in ("Thigh", "Calf", "Foot", "ToeBase")]
    missing = [name for name in names if name not in rig.pose.bones]
    if missing:
        raise RuntimeError(f"idle: missing Tripo biped bones: {missing}")
    if any(b.constraints for b in rig.pose.bones) or rig.animation_data.drivers:
        raise RuntimeError("idle: expected baked FK bones without constraints or drivers")
    if any(rig.pose.bones[name].rotation_mode != "QUATERNION" for name in names):
        raise RuntimeError("idle: symmetrise must establish quaternion channels first")
    start, end = map(float, action.frame_range)
    if end <= start:
        raise RuntimeError("idle: empty action range")
    frames = [start] + [float(f) for f in range(math.floor(start) + 1, math.ceil(end))] + [end]
    paths = {rig.pose.bones[name].path_from_id(channel): (name, channel)
             for name in names for channel in (("location",) if name == "Hip" else
                                               ("location", "rotation_quaternion", "scale"))}
    if any(c.modifiers for c in bag.fcurves if c.data_path in paths):
        raise RuntimeError("idle: remove lower-body F-curve modifiers before baking")
    ad = rig.animation_data
    saved_action, saved_slot, saved_nla = ad.action, ad.action_slot, ad.use_nla
    saved_frame = scene.frame_current + scene.frame_subframe
    saved_pose = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
    saved_position = rig.data.pose_position
    baked = []
    report = {"frames": len(frames), "frameRange": [start, end], "maxHipShift": 0.0,
              "maxAnkleCorrection": 0.0, "maxFootTilt": 0.0, "maxContactError": 0.0,
              "maxHeelToeDrift": 0.0, "maxIterations": 0}
    try:
        ad.use_nla = False
        ad.action = None
        rig.data.pose_position = "REST"
        bpy.context.view_layer.update()
        points = _skin_points(mesh, rig)
        height = float(np.ptp(points[:, 2]))
        floor = float(points[:, 2].min())
        groups = {g.index: g.name for g in mesh.vertex_groups}
        owned = {s: [] for s in "LR"}
        for vertex in mesh.data.vertices:
            if not vertex.groups or points[vertex.index, 2] > floor + height * 0.03:
                continue
            owner = groups[max(vertex.groups, key=lambda g: g.weight).group]
            for side in "LR":
                if owner in (f"{side}_Foot", f"{side}_ToeBase"):
                    owned[side].append(vertex.index)
        if any(len(owned[s]) < 3 for s in "LR"):
            raise RuntimeError("idle: insufficient Foot/Toe sole vertices in the lowest 3% of bind height")
        # The body/tail bound only selects the patch. The contact plane itself
        # comes exclusively from the feet, never a tail or an animated body bound.
        floor = min(float(points[owned[s], 2].min()) for s in "LR")
        legs = [_Leg(rig, side, points, owned[side], floor, height) for side in "LR"]
        rig.data.pose_position = "POSE"
        ad.action = action
        ad.action_slot = action.slots[0]
        sources = []
        scene.frame_set(math.floor(start) - 1)
        for frame in frames:
            for bone in rig.pose.bones:
                bone.matrix_basis = saved_pose[bone.name]
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            sources.append({b.name: b.matrix_basis.copy() for b in rig.pose.bones})
        ad.action = None
        hip = rig.pose.bones["Hip"]
        tolerance = height * 2e-5
        previous_quaternions = {}
        seam_points = []
        for frame, source in zip(frames, sources):
            # Unknowns per foot: ankle XYZ offsets and X/Y tilt expressed as
            # arc lengths. A tiny numerical Jacobian includes hip/skin coupling.
            parameters = np.zeros(10)

            def pose(values):
                for bone in rig.pose.bones:
                    bone.matrix_basis = source[bone.name]
                bpy.context.view_layer.update()
                ankles = [leg.target + Vector(values[i*5:i*5+3]) for i, leg in enumerate(legs)]
                shift = _hip_shift(legs, ankles)
                matrix = hip.matrix.copy()
                matrix.translation.z += shift
                hip.matrix = matrix
                bpy.context.view_layer.update()
                for i, leg in enumerate(legs):
                    leg.solve(ankles[i], values[i*5+3:i*5+5] / (leg.l1 + leg.l2))
                surface = _skin_points(mesh, rig)
                return np.concatenate([leg.residual(surface) for leg in legs]), surface, shift

            for iteration in range(13):
                residual, surface, shift = pose(parameters)
                error = float(np.max(np.abs(residual)))
                if not math.isfinite(error):
                    raise RuntimeError(f"idle frame {frame}: non-finite sole-contact residual")
                if error <= tolerance:
                    break
                if iteration == 12:
                    raise RuntimeError(f"idle frame {frame}: sole-contact solve did not converge; error {error:.7f}")
                step = height * 1e-4
                jacobian = np.empty((10, 10))
                for axis in range(10):
                    probe = parameters.copy()
                    probe[axis] += step
                    jacobian[:, axis] = (pose(probe)[0] - residual) / step
                delta, _, rank, _ = np.linalg.lstsq(jacobian, -residual, rcond=1e-6)
                if rank != 10:
                    raise RuntimeError(f"idle frame {frame}: singular sole-contact solve (rank {rank})")
                # Damping limits a lowest-vertex switch or nearly straight knee.
                delta *= min(1.0, height * 0.01 / max(float(np.max(np.abs(delta))), 1e-12))
                parameters += delta
            report["maxHipShift"] = max(report["maxHipShift"], abs(shift))
            report["maxContactError"] = max(report["maxContactError"], error)
            report["maxIterations"] = max(report["maxIterations"], iteration + 1)
            for i, leg in enumerate(legs):
                report["maxAnkleCorrection"] = max(report["maxAnkleCorrection"],
                                                   float(np.linalg.norm(parameters[i*5:i*5+3])))
                report["maxFootTilt"] = max(report["maxFootTilt"],
                                            float(np.linalg.norm(parameters[i*5+3:i*5+5])) / (leg.l1 + leg.l2))
                sole = surface[leg.indices]
                for patch in (leg.heel, leg.front):
                    drift = abs(float(sole[patch, 2].min() - leg.bind[patch, 2].min()))
                    report["maxHeelToeDrift"] = max(report["maxHeelToeDrift"], drift)
            if frame in (start, end):
                seam_points.append(surface[owned["L"] + owned["R"]].copy())
            sample = {}
            for path, (name, channel) in paths.items():
                value = getattr(rig.pose.bones[name], channel).copy()
                if channel == "rotation_quaternion":
                    value.normalize()
                    if name in previous_quaternions and value.dot(previous_quaternions[name]) < 0:
                        value.negate()
                    previous_quaternions[name] = value.copy()
                sample[path] = tuple(value)
            baked.append(sample)
        report["soleLoopSeam"] = float(np.linalg.norm(seam_points[1] - seam_points[0], axis=1).max())
        # Commit only after every frame solved. No sampling reads partially baked keys.
        for curve in list(bag.fcurves):
            if curve.data_path in paths:
                bag.fcurves.remove(curve)
        for path, (name, _) in paths.items():
            for index in range(len(baked[0][path])):
                curve = bag.fcurves.new(path, index=index, group_name=name)
                curve.keyframe_points.add(len(frames))
                for key, frame, sample in zip(curve.keyframe_points, frames, baked):
                    key.co = (frame, sample[path][index])
                    key.interpolation = "LINEAR"
                curve.update()
    finally:
        ad.action = saved_action
        if saved_action is not None:
            ad.action_slot = saved_slot
        ad.use_nla = saved_nla
        rig.data.pose_position = saved_position
        for bone in rig.pose.bones:
            bone.matrix_basis = saved_pose[bone.name]
        scene.frame_set(math.floor(saved_frame), subframe=saved_frame % 1)
        bpy.context.view_layer.update()
    return report
