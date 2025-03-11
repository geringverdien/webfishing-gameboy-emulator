//TODO: DECREASED PERFORMANCE AT LAST ATTEMPT-switch compression to better algorithm, contain uncompressed buffer size in packet, use manual decompress in gdscript- 

import Gameboy from '../serverboy/src/interface'; // Import the default export
import { KEYMAP } from '../serverboy/src/interface'; // Import named exports if needed
import { readFileSync, writeFileSync, existsSync } from "fs";
import "ws";
import * as path from "path";
import { PNG } from "pngjs";
import { WebSocket } from "ws";
import {deflate} from "pako"; 


const romName: string = "Garfield Labyrinth.gb";

const PORT = 24897;
const WIDTH = 160, HEIGHT = 144; // gameboy resolution
const EMULATOR_HZ = 120; // emulator runs at 120 refresh rate
const FRAMERATE = 30; // gameboy runs at ~60 fps
let inputHoldTime = 10;
let gameSpeed = 1; // use ingame command "speed num" to speed up, must be integer
const useChalksColorPalette = false // toggled ingame using "chalksmod true/false/on/off", causes the fps to drop drastically
let colorDistanceThreshold = 4000; // use ingame command "colorthreshold num" to change, helps with low fps when using Chalks colors while sacrificing color accuracy
let audioOutput = false; // use ingame command "audio true/false/on/off" to toggle audio output	

const gameboy = new Gameboy();
const romPath: string = path.join(__dirname, "..", "roms", romName);
const savePath: string = path.join(__dirname, "..", "saves", romName + ".sav")
const controllerPath: string = path.join(__dirname, "..", "controller.png")
const rom = readFileSync(romPath);
const controllerImage = readFileSync(controllerPath)
let saveData: number[] | undefined = undefined;

if (existsSync(savePath)) {
	saveData = getSaveFile();
}

const vanillaColorPalette: { [key: number]: number[] } = {
	0: [255, 238, 218], // white
	1: [5, 11, 21], // black
	2: [172, 0, 41], // red
	3: [0, 133, 131], // blue
	4: [230, 157, 0], // yellow
	6: [125, 162, 36], // green
}

const chalksModColorPalette: { [key: number]: [number, number, number] } = {
	0: [255, 238, 218], // white
	1: [5, 11, 21], // black
	2: [172, 0, 41], // red
	3: [0, 133, 131], // blue
	4: [230, 157, 0], // yellow
	6: [125, 162, 36], // green
    7: [163, 178, 210],
    8: [214, 206, 194],
    9: [191, 222, 216],
    10: [169, 196, 132],
    11: [93, 147, 123],
    12: [162, 166, 169],
    13: [119, 127, 143],
    14: [234, 178, 129],
    15: [234, 114, 134],
    16: [244, 164, 191],
    17: [160, 124, 167],
    18: [191, 121, 109],
    19: [245, 209, 182],
    20: [227, 225, 159],
    21: [255, 223, 0],
    22: [255, 191, 0],
    23: [196, 180, 84],
    24: [245, 222, 179],
    25: [244, 196, 48],
    26: [0, 255, 255],
    27: [137, 207, 240],
    28: [77, 77, 255],
    29: [0, 0, 139],
    30: [65, 105, 225],
    31: [0, 103, 66],
    32: [76, 187, 23],
    33: [46, 111, 64],
    34: [46, 139, 87],
    35: [192, 192, 192],
    36: [129, 133, 137],
    37: [137, 148, 153],
    38: [112, 128, 144],
    39: [255, 165, 0],
    40: [255, 140, 0],
    41: [215, 148, 45],
    42: [255, 95, 31],
    43: [204, 119, 34],
    44: [255, 105, 180],
    45: [255, 16, 240],
    46: [170, 51, 106],
    47: [244, 180, 196],
    48: [149, 53, 83],
    49: [216, 191, 216],
    50: [127, 0, 255],
    51: [128, 0, 128],
    52: [255, 36, 0],
    53: [255, 68, 51],
    54: [165, 42, 42],
    55: [145, 56, 49],
    56: [255, 0, 0],
    57: [59, 34, 25],
    58: [161, 110, 75],
    59: [212, 170, 120],
    60: [230, 188, 152],
    61: [255, 231, 209]
};

var usedColorPalette = useChalksColorPalette ? chalksModColorPalette : vanillaColorPalette;

type keyStates = {
	[key: string]: [number, boolean];
};

let keyStates: keyStates = {
	"UP": [0, false],
	"DOWN": [0, false],
	"LEFT": [0, false],
	"RIGHT": [0, false],
	"B": [0, false],
	"A": [0, false],
	"START": [0, false],
	"SELECT": [0, false]
}

let oldPixels = Array(23040);


function createDataBuffer(pixelArray: number[]): ArrayBuffer {
	const changedPixels: Array<any> = [];

	for (let i = 0; i < pixelArray.length; i += 4) {
		const pixelIndex = i / 4;
		const x = pixelIndex % WIDTH;
		const y = Math.floor(pixelIndex / WIDTH);

		//if (y >= HEIGHT) continue;

		const r = pixelArray[i];
		const g = pixelArray[i + 1];
		const b = pixelArray[i + 2];
		const a = pixelArray[i + 3];
		if (a === 0) { 
			continue 
		};
		const colorPaletteIndex = findClosestColor([r, g, b]);

		if (oldPixels[pixelIndex] === colorPaletteIndex) {
			continue;
		}

		oldPixels[pixelIndex] = colorPaletteIndex;
		changedPixels.push([x, y, colorPaletteIndex]);
	}

	const buffer = new ArrayBuffer(changedPixels.length * 3 + 1);
	const view = new Uint8Array(buffer);
	
	for (let i = 0; i < changedPixels.length; i++) {
		const pixel = changedPixels[i];
		view[i * 3] = pixel[0];     // x
		view[i * 3 + 1] = pixel[1]; // y
		view[i * 3 + 2] = pixel[2]; // color
	}
	
	view[view.length - 1] = 0;
	
	return buffer;
}

function createControllerPixelBuffer(pixelArray: number[]): ArrayBuffer {
	const changedPixels: Array<any> = [];

	for (let i = 0; i < pixelArray.length; i += 4) {
		const pixelIndex = i / 4;
		const x = pixelIndex % 200;
		const y = Math.floor(pixelIndex / 200);

		//if (y >= HEIGHT) continue;

		const r = pixelArray[i];
		const g = pixelArray[i + 1];
		const b = pixelArray[i + 2];
		const a = pixelArray[i + 3];
		if (a === 0) { 
			continue 
		};
		const colorPaletteIndex = findClosestColor([r, g, b]);
		changedPixels.push([x, y, colorPaletteIndex]);
	}

	const buffer = new ArrayBuffer(changedPixels.length * 3 + 1);
	const view = new Uint8Array(buffer);

	for (let i = 0; i < changedPixels.length; i++) {
		const pixel = changedPixels[i];
		view[i * 3] = pixel[0];     // x
		view[i * 3 + 1] = pixel[1]; // y
		view[i * 3 + 2] = pixel[2]; // color
	}

	view[view.length - 1] = 0;

	return buffer;
}

function createControllerBuffer(): ArrayBuffer {
	const imageDataBuffer = PNG.sync.read(controllerImage).data;
	const imageDataArray = Buffer.from(imageDataBuffer).toJSON().data;
	const buffer = createControllerPixelBuffer(imageDataArray);
	console.log(buffer.byteLength)
	const compressedControllerBuffer = deflate(buffer, { raw: false });
	return compressedControllerBuffer;
}

function frequencyToMidiNote(frequency: number): number {
	const noteNumber = 12 * Math.log2(frequency / 440) + 69;
	return Math.round(noteNumber);
	
  }

function createAudioDataBuffer(audioData: number[][]): ArrayBuffer {
	const audioBuffer = new ArrayBuffer(audioData.length*2 + 1);
	const view = new Uint8Array(audioBuffer);
	for (let i = 0; i < audioData.length; i++) {
		const channelData = audioData[i];
		const isPlayingFlag = channelData[0]
		const frequency = channelData[1]
		const notePitch = frequency > 0 ? frequencyToMidiNote(frequency) : 0;
		view[i * 2] = isPlayingFlag;
		view[i * 2 + 1] = notePitch; // note pitch
	}

	view[view.length - 1] = 1;
	const compressedControllerBuffer = deflate(audioBuffer, { raw: false });
	return compressedControllerBuffer;
}

function findClosestColor(target: number[]): number {
	let minDistance = Infinity;
	let closestKey = 0;

	for (const [key, color] of Object.entries(usedColorPalette)) {
	  	const dr = target[0] - color[0];
	  	const dg = target[1] - color[1];
	  	const db = target[2] - color[2];
	  	const distanceSq = dr * dr + dg * dg + db * db;

		if (distanceSq < colorDistanceThreshold) {
			return Number(key);
		}

	  	if (distanceSq < minDistance) {
			minDistance = distanceSq;
			closestKey = Number(key);
		}
	}

	return closestKey;
}

function getPressedKeys(): number[] {
	const currentlyPressed: number[] = [];

	for (const [keyName, keyData] of Object.entries(keyStates)) {
		const framesRemaining = keyData[0]
		const isHeldDown = keyData[1]
		const hasZeroTicks = framesRemaining === 0
		if (hasZeroTicks && isHeldDown === false) {
			continue;
		}
		
		if (!hasZeroTicks) {
			keyStates[keyName][0] -= 1;
		}
		
		const key = keyName as keyof typeof KEYMAP;

		currentlyPressed.push(KEYMAP[key]);
	}
	//if (currentlyPressed.length > 0) {console.log(currentlyPressed) };
	return currentlyPressed;
}

function sramToBuffer(integers: number[]): Buffer {
	const buffer = Buffer.alloc(integers.length * 4);

	for (let i = 0; i < integers.length; i++) {
		buffer.writeInt32BE(integers[i], i * 4);
	}

	return buffer;
}

function saveSRAM(integers: number[]): void {
	const buffer = sramToBuffer(integers);
	writeFileSync(savePath, buffer);
}

function bufferToIntegers(buffer: Buffer): number[] {
	const integers: number[] = [];

	for (let i = 0; i < buffer.length; i += 4) {
		const integer = buffer.readInt32BE(i);
		integers.push(integer);
	}

	return integers;
}

function getSaveFile(): number[] {
	const buffer = readFileSync(savePath);
	return bufferToIntegers(buffer);
}

function storeSaveData() {
	const sram = gameboy.getSaveData()
	saveSRAM(sram)
}


const socket = new WebSocket("ws://127.0.0.1:" + PORT.toString());

gameboy.loadRom(rom, saveData)

socket.onopen = () => {
	console.log("WebSocket connection opened");
	const intervalTime = 1000 / FRAMERATE;
	
	const stepsPerInterval = EMULATOR_HZ / FRAMERATE;
	let frameCount = 0

	const controllerData = createControllerBuffer();
	socket.send(controllerData);


	const frameInterval = setInterval(() => {
		for (let i = 0; i < (stepsPerInterval * gameSpeed); i++) {
			gameboy.pressKeys(getPressedKeys());
			gameboy.doFrame();
		}

		const frame: number[] = gameboy.getScreen();
		const rawBuffer = createDataBuffer(frame);
		const compressedBuffer = deflate(rawBuffer, { raw: false });
   
		
		if (socket.readyState !== WebSocket.OPEN) { return }
		socket.send(compressedBuffer);
  
	}, intervalTime);

	const audioInterval = setInterval(() => {
		if (!audioOutput) { return }
		const audioData = gameboy.getAudio();
		//console.log(audioData)
		const buffer = createAudioDataBuffer(audioData)

		if (socket.readyState !== WebSocket.OPEN) { return }
		socket.send(buffer);
	}, intervalTime)

	socket.onmessage = (event) => {
		let message: string = event.data.toString();
		console.log("MESSAGE: " + message);
		let splitMessage: any[] = message.split("|");
		const command = splitMessage[0];
		console.log(command);
		const args = splitMessage.slice(1);
		switch (command) {
			case "input":
				var keyString: any = args[0];
				keyStates[keyString][0] = inputHoldTime;
				break;
			case "keydown":
				var keyString: any = args[0];
				keyStates[keyString][1] = true;
				break;
			case "keyup":
				var keyString: any = args[0];
				keyStates[keyString][1] = false;
				break;
			case "savegame":
				console.log("saving state");
				storeSaveData();
				break;
			case "setspeed":
				var newSpeed = Math.floor(Number(args[0]));
				console.log(`set speed to ${newSpeed}`);
				gameSpeed = newSpeed;
				break;
			case "setholdtime":
				var newHoldTime = Math.floor(Number(args[0]));
				inputHoldTime = newHoldTime;
				break;
			case "setchalkmode":
				var useModdedChalk = args[0] === "true";
				usedColorPalette = useModdedChalk ? chalksModColorPalette : vanillaColorPalette;
				break;
			case "setcolorthreshold":
				var newThreshold = Math.floor(Number(args[0]));
				colorDistanceThreshold = newThreshold;
				break;
			case "setaudio":
				var audioToggle = args[0] === "true";
				audioOutput = audioToggle;
				break;
		}
	}

	socket.onclose = () => {
		clearInterval(frameInterval);
		console.log("WebSocket connection closed");
	}


}

/**

let pixels = gameboy.getScreen()

let png = new PNG({ width: 160, height: 144 });

for (let i=0; i < 50; i++) {
	gameboy.doFrame()
}

for (let i=0; i<pixels.length; i++) {
   png.data[i] = pixels[i];
}

let buffer = PNG.sync.write(png);
writeFileSync("out.png", buffer);
*/