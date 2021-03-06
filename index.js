var stream = require('stream-wrapper');
var Connection = require('ssh2');
var fs = require('fs');
var path = require('path');

var HOME = process.env.HOME || process.env.USERPROFILE;

var noop = function() {};

var exec = function(cmd, opts) {
	var c = new Connection();
	var buffer = null;
	var waiting = noop;

	var duplex = stream.passThrough(noop, function(data, enc, callback) {
		buffer = data;
		waiting = callback;
	});

	c.on('ready', function() {
		c.exec(cmd, {env:opts.env}, function(err, stdio) {
			if (err) return c.emit('error', err);

			var drained = true;
			var update = function() {
				if (!stdio.readable) return;
				if (drained && stdio.paused) stdio.resume();
				else if (!drained && !stdio.paused) stdio.pause();
			};

			duplex._read = function() {
				drained = true;
				process.nextTick(update);
			};

			duplex._write = function(data, enc, callback) {
				if (stdio.write(data) !== false) return callback();
				stdio.once('drain', callback);
			};

			duplex.on('finish', function() {
				stdio.end();
			});

			stdio.on('data', function(data) {
				if (duplex.push(data)) return;
				drained = false;
				process.nextTick(update);
			});

			stdio.on('end', function() {
				duplex.push(null);
			});

			stdio.on('close', function() {
				duplex.destroy();
			});

			stdio.on('exit', function(code) {
				duplex.emit('exit', code);
			});

			if (!buffer) return;

			duplex._write(buffer, null, waiting);
			buffer = null;
			waiting = noop;
		});
	});

	c.on('error', function(err) {
		duplex.emit('error', err);
		duplex.destroy();
	});

	c.on('close', function() {
		duplex.destroy();
	});

	duplex.on('close', function() {
		c.end();
	});

	var key = opts.key === false ? undefined : opts.key || path.join(HOME, '.ssh', 'id_rsa');

	var connect = function() {
		c.connect({
			host:opts.host,
			username:opts.user,
			password:opts.password,
			port:opts.port || 22,
			privateKey:key
		});
	};

	if (!key || Buffer.isBuffer(key)) {
		connect();
	} else {
		fs.readFile(key, function(_, buffer) {
			key = buffer;
			connect();
		});
	}

	return duplex;
};

module.exports = function(cmd, opts) {
	if (typeof opts === 'string') {
		opts = opts.match(/^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/) || [];
		opts = {
			host: opts[2],
			user: opts[1],
			port: parseInt(opts[3], 10) || 22
		};
	}

	return exec(cmd, opts);
};