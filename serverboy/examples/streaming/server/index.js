//In your program, this line will be - var gameboy = require('serverboy');
var gameboy = require('../../../src/interface.js');

var fs = require('fs');
var socket = require('socket.io');
var app = require('express')();
var http = require('http').Server(app);
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

var currentScreen;

function loadROM(file_path) {

	  var rom = fs.readFileSync(file_path);

	  //start the rom.
	  var gameboy_instance = new gameboy();
	  gameboy_instance.loadRom(rom);

	  var io; //Handle streaming.
	  var keysToPress = []; //What keys we want pressed.
    var sram = [];
	  var start_io = function() {
		    //io = socket(process.env.PORT || process.env.NODE_PORT || 3333);
        io = socket(http);

		    io.on('connection', function(socket){
            console.log('connection happened');
			      //Logic for handeling a new connection here.
			      //ie. registering a user or something similar.

			      //The new connection can send commands.
			      socket.on('keydown', function(data) {
				        var index = keysToPress.indexOf(data.key);
				        if(index === -1) {
					          keysToPress.push(data.key);
				        }
			      });

			      socket.on('keyup', function(data) {
				        var index = keysToPress.indexOf(data.key);
				        if(index !== -1) {
					          keysToPress.splice(index, 1);
				        }
			      });

			      socket.on('restart', function(data) {
                sram = gameboy_instance.getSaveData();
				        gameboy_instance.loadRom(rom, sram);
			      });

		    });
	  };

	  //Handle doing a single frame.
    //You want to basically time this at about 60fps.
	  var frames = 0; var lastFrame = undefined; var currentFrame = undefined;
    var audioLoop = [];
	  var emulatorLoop = function() {
        var start = process.hrtime();

		    gameboy_instance.pressKeys(keysToPress);
		    currentScreen = gameboy_instance.doFrame();

        let currentAudio = gameboy_instance.getAudio();

        //Compress into mono - literally throw away half the frames :)
        for (let i = 0; i < 705; i+=2) {
            audioLoop.push(currentAudio[i]);
        }

		    frames++;
		    if(frames%10 === 0) { //Output every 10th frame.
			      if(io) {
                // console.log(frames);

				        io.emit('frame', currentScreen);
                io.emit('memory', gameboy_instance.getMemory());
                // io.emit('audio', audioLoop);
                audioLoop = [];
			      }
		    }

        var elapsed = process.hrtime(start)[1] / 1000000;
        setTimeout(emulatorLoop, 5); //Try and run at about 60fps.
	  };


	  start_io();
	  emulatorLoop();
}


console.log('starting to load rom');
loadROM("roms/pokeyellow.gbc");

http.listen(3002, function () {
    console.log('listening on *:3002');
});
