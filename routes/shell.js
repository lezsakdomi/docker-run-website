const express = require('express');
const router = express.Router({});
const pty = require('node-pty');

const ttry = f => {
    return function () {
        try {
            return f.apply(this, arguments);
        } catch (e) {
            console.error(e);
        }
    }
};

router.use(require('../middlewares/protect').superuser);

router.get('/', (req, res) => {
    res.render('shell', {
        title: "Shell access"
    });
});

// noinspection JSUnresolvedFunction
router.websocket('/bash/:cols/:rows', function ({req}, cb) {
    cb(socket => {
        const ttry = f => {
            return function () {
                try {
                    return f.apply(this, arguments);
                } catch (e) {
                    try {
                        socket.send(e.stack.replace(/\n/g, "\r\n"));
                    } catch (e2) {
                        console.error(e2, e);
                    }
                }
            }
        };

        ttry(() => {
            // noinspection JSCheckFunctionSignatures
            const terminal = pty.spawn('bash', ['-i', '-l'], { //TODO run in Docker
                name: 'xterm-color',
                cols: parseInt(req.params.cols),
                rows: parseInt(req.params.rows),
                cwd: process.env.HOME,
                env: process.env,
            });

            socket.on('message', ttry(message => {
                return terminal.write(message);
            }));

            socket.on('close', ttry(() => {
                console.debug("Socket closed");
                return terminal.kill('SIGHUP');
            }));

            terminal.on('data', ttry(data => {
                return socket.send(data);
            }));

            terminal.on('close', ttry(() => {
                console.debug("Terminal exited");
                socket.send("\r\n");
            }));

            terminal.on('exit', ttry((code, signal) => {
                console.debug("Terminal exited");
                socket.send("Process terminated. Exit code: \033[1m" + code + "\033[0m");
                if (signal) socket.send(" (got signal \033[1;31m" + signal + "\033[0m)");
                return socket.close();
            }));
        })();
    });
});

module.exports = router;