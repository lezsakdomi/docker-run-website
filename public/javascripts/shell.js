Terminal.applyAddon(attach);
Terminal.applyAddon(fit);

function inputOpt(name, def) {
    const elements = document.getElementsByName(name);
    if (elements.length) {
        return elements[0].value;
    } else {
        return def;
    }
}

document.addEventListener("DOMContentLoaded", event => {
    const term = new Terminal();
    term.open(document.getElementById('#terminal'));
    term.fit();

    let socket;
    try {
        const l = window.location;
        const uri = (l.protocol === "https:" ? "wss://" : "ws://") + l.host + '/' +
            inputOpt('socket', '/shell/bash') + '/' + term.cols + '/' + term.rows;
        socket = new WebSocket(uri);
        socket.addEventListener('error', () => {
            term.write("\033[31;1mConnection error\033[0m");
        });
        socket.addEventListener('close', console.debug);
    } catch (e) {
        term.write("\033[31mFailed to open connection to remote socket\033[0m\n");
        term.write(e.trace);
    }
    term.attach(socket);

    if (inputOpt('auto-back', true)) {
        socket.addEventListener('close', () => window.history.back());
    }

    window.term = term;
    window.socket = socket;

    term.focus();
});