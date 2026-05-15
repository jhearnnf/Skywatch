import { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

// ── Asset contract ──────────────────────────────────────────────────────────
// Stickman3D loads a single rigged GLB and drives it from the actor state the
// existing brief-reel timeline already produces (faction / mode / speaking /
// pulseCount / facing). To swap in a custom character, drop a `.glb` at the
// `url` prop's path with the following requirements:
//
//   Mesh:
//     - One primary skinned mesh ("Body" or first SkinnedMesh found). Its
//       material's base colour is replaced at runtime by the faction tint.
//     - Stickman-style geometry preferred — head + simple body — but any
//       humanoid rig works for the prototype.
//
//   Skeleton:
//     - Mixamo-compatible bone names (`mixamorig:Hips`, `mixamorig:Spine`,
//       …) are fine; not strictly required since we don't drive bones
//       directly, only animation clips.
//
//   Animation clips — names must match these exactly (Mixamo's default
//   names are the convention; rename in Blender/code if your source uses
//   different labels):
//     - Idle          (continuous loop, no foot movement, gentle sway)
//     - Walk          (used during enter/walk-to/exit)
//     - Salute        (one-shot, ~1.2s)
//     - Argue         (continuous loop, agitated gesture)
//     - Talk          (continuous loop, mouth/hand movement while speaking)
//     - Point         (one-shot, ~1.0s — points forward)
//     - Pilot         (continuous loop, hands-on-controls pose)
//
//   Forward direction:
//     - Character faces +Z by default. `facing` prop rotates around Y.
//
// Free sources for a quick prototype:
//   - Mixamo: https://www.mixamo.com (free with Adobe account). Download "X
//     Bot" or "Y Bot" + the seven animations above as one FBX each, then
//     combine into a single GLB with named clips using Blender.
//   - Khronos sample models: CesiumMan.glb has Walk built in — useful for
//     verifying the integration loads at all, but it ships with only one
//     clip so most state changes will fall back to that single animation.
//
// The component is FAULT-TOLERANT: a missing clip silently falls back to
// `Idle`, and a missing model surfaces via an ErrorCatcher in the parent
// (Stage3DOverlay), which reverts the whole stage to SVG.

const FACTION_TINT = {
  'raf-primary':   '#f97316',
  'raf-secondary': '#5baaff',
  'ally':          '#e2e8f0',
  'civilian':      '#94a3b8',
  'adversary':     '#dc2626',
};

const MODE_TO_CLIP = {
  standing: 'Idle',
  saluting: 'Salute',
  arguing:  'Argue',
  piloting: 'Pilot',
};

export default function Stickman3D({
  url = '/models/stickman.glb',
  position,
  mode,
  faction,
  isSpeaking,
  pointing,
  pulseCount,
  facing = 'front',
}) {
  const group = useRef();
  const { scene, animations } = useGLTF(url);
  // Clone once per character — three.js shares scene graph across instances
  // by default and re-cloning every render resets animation state mid-clip.
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const { actions, mixer } = useAnimations(animations, group);

  // Pick the active clip based on the actor's current state. The priority
  // is: explicit mode > pointing one-shot > speaking > pulse one-shot >
  // idle. Speaking is only a continuous clip; pulse re-fires its one-shot
  // when pulseCount changes.
  const targetClip = useMemo(() => {
    if (mode && MODE_TO_CLIP[mode]) return MODE_TO_CLIP[mode];
    if (pointing)   return 'Point';
    if (isSpeaking) return 'Talk';
    return 'Idle';
  }, [mode, pointing, isSpeaking]);

  // Drive the AnimationMixer: cross-fade between clips so transitions don't
  // snap. Fall back to Idle if the requested clip isn't in the GLB.
  useEffect(() => {
    if (!actions) return;
    const wanted = actions[targetClip] || actions['Idle'];
    if (!wanted) return;
    wanted.reset().fadeIn(0.35).play();
    return () => { wanted.fadeOut(0.25); };
  }, [actions, targetClip]);

  // Pulse one-shot — replay the Point clip when pulseCount bumps. (Using
  // Point as the "emphasis" clip since most rigs have it; if your GLB
  // includes a dedicated "Pulse" clip you can swap this.)
  useEffect(() => {
    if (!pulseCount || !actions?.Point) return;
    const action = actions.Point;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.fadeIn(0.1).play();
  }, [pulseCount, actions]);

  // Tint the body mesh to match the faction colour. Clones the material so
  // each instance can carry its own tint without polluting the shared GLB.
  useEffect(() => {
    if (!cloned) return;
    const tint = new THREE.Color(FACTION_TINT[faction] || FACTION_TINT['raf-secondary']);
    cloned.traverse(obj => {
      if (obj.isMesh && obj.material) {
        if (!obj.userData.briefReelTinted) {
          obj.material = obj.material.clone();
          obj.userData.briefReelTinted = true;
        }
        if (obj.material.color) obj.material.color.copy(tint);
        if (obj.material.emissive) obj.material.emissive.copy(tint).multiplyScalar(0.05);
      }
    });
  }, [cloned, faction]);

  // Facing rotation. Stage is left-to-right; characters in the "left" slot
  // face right toward stage centre, characters on "right" face left.
  const facingRot =
    facing === 'left'  ?  Math.PI / 2 :
    facing === 'right' ? -Math.PI / 2 :
    0;

  return (
    <group ref={group} position={position} rotation={[0, facingRot, 0]}>
      <primitive object={cloned} />
    </group>
  );
}

// Pre-load so the first reel-open doesn't stall on the GLB fetch.
useGLTF.preload('/models/stickman.glb');
