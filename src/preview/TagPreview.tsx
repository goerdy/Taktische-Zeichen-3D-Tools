import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TagConfig } from "../geometry/tagConfig";
import { createTagGeometries } from "../geometry/tagGeometry";
import type { SymbolLayer } from "../symbols/symbolLayer";

export function TagPreview({
  config,
  symbolLayers,
}: {
  config: TagConfig;
  symbolLayers?: SymbolLayer[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    frameId: number;
    tagGroup: THREE.Group;
  } | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const host = hostRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 1000);
    camera.position.set(0, -72, 58);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 18, 1.8);

    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(30, -40, 70);
    scene.add(keyLight);

    const grid = new THREE.GridHelper(90, 18, 0x334155, 0xd6dde8);
    grid.rotation.x = Math.PI / 2;
    grid.position.y = 18;
    grid.position.z = -0.04;
    scene.add(grid);

    const tagGroup = new THREE.Group();
    scene.add(tagGroup);

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      sceneRef.current!.frameId = requestAnimationFrame(render);
    };
    const frameId = requestAnimationFrame(render);

    sceneRef.current = { renderer, scene, camera, controls, frameId, tagGroup };

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(sceneRef.current?.frameId ?? frameId);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;

    current.tagGroup.clear();

    const baseMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.baseColor),
      roughness: 0.62,
      metalness: 0.03,
    });

    const { baseBottom, baseTop, inlays } = createTagGeometries(config, symbolLayers);
    current.tagGroup.add(new THREE.Mesh(baseBottom, baseMaterial));
    current.tagGroup.add(new THREE.Mesh(baseTop, baseMaterial));

    for (const inlay of inlays) {
      current.tagGroup.add(
        new THREE.Mesh(
          inlay.geometry,
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(inlay.color),
            roughness: 0.5,
            metalness: 0.02,
            side: THREE.DoubleSide,
          }),
        ),
      );
    }

    current.tagGroup.position.y = -config.height / 2;
    current.controls.target.set(0, config.height / 2, config.baseThickness / 2);
  }, [config, symbolLayers]);

  return (
    <div className="preview-frame">
      <div className="preview-toolbar">
        <span>3D Vorschau</span>
        <span>Orbit: drehen, zoomen, verschieben</span>
      </div>
      <div className="canvas-host" ref={hostRef} />
    </div>
  );
}
