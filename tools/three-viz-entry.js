// Точка входа для js/vendor/three/three-viz.min.js — three.js 0.186.0 только с нужными вкладке «Визуализация» частями.
// Сборка: npm i three@0.186.0 esbuild && npx esbuild tools/three-viz-entry.js --bundle --minify --format=iife --global-name=LogiThree --target=es2019 --legal-comments=inline --outfile=js/vendor/three/three-viz.min.js
export {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, InstancedMesh, BoxGeometry, CylinderGeometry, PlaneGeometry, CircleGeometry,
  ExtrudeGeometry, ShapeGeometry, Shape, EdgesGeometry, LineSegments, LineBasicMaterial, MeshStandardMaterial, MeshLambertMaterial, MeshBasicMaterial,
  HemisphereLight, DirectionalLight, Color, Object3D, Matrix4, Vector3, Vector2, Quaternion, Box3, Raycaster, Sprite, SpriteMaterial,
  CanvasTexture, SRGBColorSpace, DoubleSide, GridHelper, Fog, PMREMGenerator, PCFShadowMap, NeutralToneMapping,
  // высокое качество: лак, хром, точёные колёса, буфер для эффектов
  MeshPhysicalMaterial, LatheGeometry, TorusGeometry, SphereGeometry, WebGLRenderTarget, HalfFloatType, RepeatWrapping
} from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// эффекты высокого качества: тени в щелях (GTAO), свечение фар (bloom), вывод с тоном и цветом сайта
export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
export { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
