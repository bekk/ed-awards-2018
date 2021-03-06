THREE.OrbitControls = require('three-orbit-controls')(THREE);

import ioClient from 'socket.io-client';

import Bird from "./bird.js";
import { fetchTextureFromServer, Random, ratio, clamp, easeInOutSine } from './util.js';
import Manhattan from './manhattan.js';
import People from './people.js';
import Telly from './telly.js';
import { KingsCross, Background } from './kingscross.js';
import RealtimeTextureCollection from "./realtime-texture-collection.js";
import PlingPlongTransition from "./pling-plong-transition.js";

const socket = ioClient("http://localhost:3000");

// FINAL TODO:
// ============
// Blinking i People
// Glitch i Manhattan
// Glitch i Kings Cross også

// Få grønne rader i Kings Cross (og hoder på hver sin undertype)

// ======

// Jobbe sammen om fargene på Manhattan

// Lavest pri: Mørkeblå på sidene i rulletrappgropa, lyseblå på gulvet. Hex kommer fra Audun

let timeStart;
let camera;
let renderer;
let scene;
let animation;
let orbitControls;
let textureCollection;
const animations = {};
let animationIndex = 0;
let realtimeTextureCollection;

let otherCamera;
let otherScene;
let transition;

let backgroundCamera;
let backgroundScene;
let background;

window.fpsFactor = 1.0;
window.lastTime = new Date().getTime();

window.debug = false;

const intervalMinutes = [10, 3, 10, 10];
//const intervalMinutes = [1, 0.5, 1, 1];

const uniforms = {
	time: {value: 0.0},
};

socket.on('new image', (fileName)  => {
	console.log(`Downloading new image: ${fileName}`);
	addImage(fileName);
})

socket.on('remove image', (fileName)  => {
	removeImage(fileName);
})

let knownFiles = [];
fetch('http://localhost:3000/all')
  .then(function(response) {
    return response.json();
  })
  .then(function(myJson) {
    knownFiles = myJson.files.filter((filename) => filename.indexOf(".png") != -1);
    console.log("Known files:", knownFiles.length)
    //console.log(knownFiles)
  });
let knownFilesIndex = 0;

const addImage = function(fileName) {
	const metadata = realtimeTextureCollection.getMetadata(fileName)

	const texture = fetchTextureFromServer(`http://localhost:3000/${fileName}`);

	texture.fileName = fileName;

	if (metadata.animation == "people") {
		animations.people.updateImage(texture, metadata);
	} else if (metadata.animation == "manhattan") {
		animations.manhattan.updateImage(texture, metadata);
		animations.telly.updateImage(texture, metadata);
	} else if (metadata.animation == "kingscross") {
		animations.kingsCross.updateImage(texture, metadata);
	} else {
		throw "ERROR: ukjent animation: " + metadata.animation
	}
}

function addKnownFile() {

	if (knownFilesIndex > knownFiles.length - 1) {
		console.log("All files added");
		return true;
	};

	const fileName = knownFiles[knownFilesIndex++];

	console.log("Adding", fileName)

	addImage(fileName);
}

const removeImage = function(fileName) {
	console.log(`REMOVING image: ${fileName}`);
	for (let animation of [animations.people, animations.manhattan, animations.telly, animations.kingsCross]) {
		animation.scene.traverse(function(child) {
			if (child.material && child.material.map && child.material.map.fileName && child.material.map.fileName == fileName) {
				console.log("Found map to remove");
				child.material.map = realtimeTextureCollection.getBald();
				child.material.map.anisotropy = Math.pow(2, 3);
				child.material.map.minFilter = THREE.LinearMipMapLinearFilter;
				child.material.needsUpdate = true;
			}
		})
	}

	animations.manhattan.removeImage(fileName);
}

const initAnimation = function(domNodeId, canvasId) {
	timeStart = new Date().getTime();

	renderer = new THREE.WebGLRenderer({antialias: true});
	renderer.gammaInput = false;
	renderer.gammaOutput = false;
	renderer.setClearColor(0x404040);
	renderer.domElement.setAttribute('id', canvasId);
	renderer.setSize(window.innerWidth, window.innerHeight, true);
	renderer.autoClear = false;
	renderer.setPixelRatio(2);

	// Skur 13: 1240 861
	// Skur 13 60hz: 1491 1080
	console.log(window.innerWidth, window.innerHeight); // 1680, 1050

	console.log(
		renderer.getContext().getParameter(renderer.getContext().MAX_VERTEX_TEXTURE_IMAGE_UNITS),
		renderer.getContext().getParameter(renderer.getContext().MAX_TEXTURE_SIZE),
	);

	document.getElementById(domNodeId).appendChild(renderer.domElement);

    // 256 stykker på 1024^2 ser ut til å være en øvre grense for rendringen nå
    // eller overkant av 1000 stykker på 512^2
    const nofTextures = 400;
    const textureWidth = 512;
    const textureHeight = 512;
	realtimeTextureCollection = new RealtimeTextureCollection(nofTextures, textureWidth, textureHeight);

	animations.people = new People(renderer, realtimeTextureCollection);
	animations.manhattan = new Manhattan(renderer, realtimeTextureCollection);
	animations.telly = new Telly(renderer, realtimeTextureCollection);
	animations.kingsCross = new KingsCross(renderer, realtimeTextureCollection);

	changeAnimation(animations.people);

	// TODO: Skift til 12.4 * 7, x * y piksler
	// TODO: Sjekk ytelsen om bildene er 1024^2. Det blir litt stygt når zoomet ut nå
	// TODO: Hent alle bilder på nytt hvis restart

	document.getElementById("manhattan").onclick = function() { 
		changeAnimation(animations.manhattan);
	};
	document.getElementById("people").onclick = function() { 
		changeAnimation(animations.people);
	};
	document.getElementById("telly").onclick = function() { 
		changeAnimation(animations.telly);
	};
	document.getElementById("kingsCross").onclick = function() { 
		changeAnimation(animations.kingsCross);
	};
	document.getElementById("zoomOut").onclick = function() { 
		zoomOut();
	};
	document.getElementById("stopSwing").onclick = function() { 
		transition.stopSwing();
	};
	document.getElementById("pressButton").onclick = function() { 
		transition.pressButton();
	};
	document.getElementById("releaseButton").onclick = function() { 
		transition.releaseButton();
	};
	document.getElementById("zoomIn").onclick = function() { 
		zoomIn();
	};
	document.getElementById("addImage").onclick = addKnownFile;

	document.getElementById("orchestrate").onclick = function() { 
		orchestrate();
	};
	document.getElementById("removeImage").onclick = function() {
		window.removeIndex = window.removeIndex || 0;
		removeImage(knownFiles[removeIndex]);
		removeIndex++;
	};
	document.getElementById("addAllImages").onclick = function() {
		addAllImages();
	};

	if (true) initAutoOrchestrate();

    otherCamera = new THREE.PerspectiveCamera(45, ratio(renderer), 0.01, 10000);
    otherCamera.position.set(0, 0, 3);
    otherCamera.updateProjectionMatrix();

    otherScene = new THREE.Scene();
    transition = new PlingPlongTransition(otherCamera);
    otherScene.add(transition);

    backgroundCamera = new THREE.PerspectiveCamera(45, ratio(renderer), 0.01, 10000);
    backgroundCamera.position.set(0, 0, 3);
    backgroundCamera.lookAt(new THREE.Vector3(0, 0, 0))
    backgroundCamera.updateProjectionMatrix();

    backgroundScene = new THREE.Scene();
    background = new Background();
    backgroundScene.add(background);
	
	zoomOut();


	if (false) window.setTimeout(addAllImages, 2000);
}
		
		window.state = 0;
		window.transitionStartTime = 0;

function addAllImages() {
	(function foo() {
		const result = addKnownFile();
		if (result !== true) window.setTimeout(foo, 200); // 1200 files ~ 5 minutes @ 200 ms
	})();
}

const changeAnimation = function(newAnimation) {
	scene = newAnimation.scene
	camera = newAnimation.camera;
	animation = newAnimation;
}

const getNextAnimation = function() {
	let total = 0;
	const array = [];
	for (let key in animations) {
		total++;
		array.push(animations[key]);
	}

	animationIndex = (animationIndex + 1) % total;

	return array[animationIndex];
}

const initAutoOrchestrate = function() {
	function callback() {
		orchestrate(); 
		const nextIndex = (animationIndex + 1) % intervalMinutes.length;
		setTimeout(callback, intervalMinutes[nextIndex]*60*1000);
	}

	setTimeout(callback, intervalMinutes[animationIndex]*60*1000);
}

const orchestrate = function() {
	zoomOut();
	transition.onButtonTop((times) => {
		if (times == 3) {
			transition.stopSwing();
			transition.onButtonDown(() => changeAnimation(getNextAnimation()));
			setTimeout(() => transition.pressButton(), 1000);
			setTimeout(zoomIn, 3000);
		}
	});

}

const zoomOut = function() {
	transition.resetAnimation();
	window.state = 1;
	window.transitionStartTime = new Date().getTime();
}

const zoomIn = function() {
	window.state = 3;
	window.transitionStartTime = new Date().getTime();
}

const animate = function() {
	requestAnimationFrame(animate);

	uniforms.time.value = (new Date().getTime() - timeStart) / 1000;

	window.fpsFactor = (new Date().getTime() - window.lastTime)/(1000/60);
	window.lastTime = new Date().getTime()

	animations.people.animate();
	animations.manhattan.animate();
	animations.telly.animate();
	animations.kingsCross.animate();

		transition.animate();

	    let normalizedZoom;
	    let speed = 0.5;
	    if (window.state == 1) {
	    	const timeDiff = (new Date().getTime() - window.transitionStartTime) / 1000;
	    	const eased = easeInOutSine(clamp(timeDiff * speed, 0, 1));
	    	normalizedZoom = 1 - eased;
	    	if (eased == 1) window.state = 2;
	    } else if (window.state == 3) {
	    	const timeDiff = (new Date().getTime() - window.transitionStartTime) / 1000;
	    	const eased = easeInOutSine(clamp(timeDiff * speed, 0, 1));
	    	normalizedZoom = eased;
	    	if (eased == 1) window.state = 0;
	    } else if (window.state == 2) {
			normalizedZoom = 0;
	    } else {
	    	normalizedZoom = 1;
	    }

		transition.zoom(normalizedZoom);

		animations.people.zoomAmount(normalizedZoom);
		animations.manhattan.zoomAmount(normalizedZoom);
		animations.telly.zoomAmount(normalizedZoom);
		animations.kingsCross.zoomAmount(normalizedZoom);
	
	renderer.clear();
	if (animation == animations.kingsCross) 
		renderer.render(backgroundScene, backgroundCamera);

	renderer.clearDepth();
	renderer.render(scene, camera);

	renderer.clearDepth();
	renderer.render(otherScene, otherCamera);
}

export default function main() {
	initAnimation("container", "renderer");
	animate();
}