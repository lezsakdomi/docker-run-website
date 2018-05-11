const express = require('express');
const router = express.Router({});
const Docker = new require('dockerode');
const webscoketStream = require('websocket-stream');
const {Collect} = require('stream-collect');
const MongoDB = require('mongodb');
const tar = require('tar');
const protect = require('../middlewares/protect');
const EventedArray = require('array-events');

const image = 'server-setup';
const docker = new Docker();

const setups = new EventedArray();

function reloadSetups() {
    db.then(db => {
        db.collection('setups').find().sort({dateStarted: -1}).toArray().then(result => {
            setups.slice(0, 0);
            setups.combine(result);
        });
    });
}

const containers = new EventedArray();

function reloadContainers() {
    docker.listContainers({
        all: true,
        //TODO filter
    }).then(result => {
        containers.slice(0, 0);
        containers.combine(result.map(c => c.Id));
    });
}

function reload() {
    reloadContainers();
    reloadSetups();
}

reload();

router.use(protect);

router.get('/', (req, res, next) => {
    global.db.then(db => {
        const collection = db.collection('setups');
        collection.find().sort({dateStarted: -1}).toArray().then(setups => res.render('setups', {
            title: "Manage setups", setups: setups, containers: containers,
            user: req.user,
        }), next);
    }, err => res.status(500).render('error', {
        title: "Database error",
        message: "Database connection failed", error: err,
    }));
});

router.post('/reload', protect.superuser, (req, res) => {
    reload();
    res.redirect('/setups');
});

router.websocket('/updates', ({req}, cb) => {

});

router.get('/new', (req, res) => {
    res.render('shell', {
        title: "New server setup",
        socket: '/setups/new',
    });
});

router.websocket('/new/:w/:h', ({req}, cb) => {
    const dateStarted = new Date();

    cb(socket => {
        const ttry = f => {
            function fail(e) {
                try {
                    socket.send(e.stack.replace(/\n/g, "\r\n"));
                    console.warn(e);
                } catch (e2) {
                    console.error(e2, e);
                }
            }

            return function () {
                try {
                    const res = f.apply(this, arguments);
                    if (res && res.catch) res.catch(fail);
                    return res;
                } catch (e) {
                    fail(e);
                }
            }
        };

        ttry(() => {
            socket.send("Spinning up a container for you...\r");

            docker.createContainer({
                'Tty': true,
                'OpenStdin': true,
                'Image': image,
            }, ttry((err, container) => {
                if (err) throw err;
                containers.push(container.id);
                //TODO wait until removed, then slice (or filter) out

                container.attach({
                    stream: true,
                    stdin: true,
                    stdout: true,
                    stderr: true,
                }, ttry((err, dockerStream) => {
                    if (err) throw err;
                    const dockerCollect = dockerStream.pipe(new Collect());

                    socket.send("\033[2K");

                    const remoteStream = webscoketStream(socket, {binary: true});
                    const remoteCollect = remoteStream.pipe(new Collect());

                    dockerStream.pipe(remoteStream);
                    remoteStream.pipe(dockerStream);


                    container.start().then(ttry(container => {
                        if (err) throw err;

                        remoteStream.on('close', ttry(() => {
                            try {
                                container.kill({signal: "SIGHUP"}).catch(() => undefined);
                            } catch (e) {
                                // intended path
                            }
                        }));

                        container.resize(req.params);

                        container.wait(ttry((err, data) => {
                            if (err) throw err;

                            const archive = container.getArchive({path: "/exports"});

                            let dataPromise = new Promise(resolve => resolve({
                                dateStarted: dateStarted,
                                dateFinished: new Date(),
                                container: container.id,
                                dockerData: data,
                            }));

                            // Put this object's entries into dataPromise wrapped by `then`s
                            Object.entries({
                                input: remoteCollect.collect(),
                                output: dockerCollect.collect(),
                                archive: archive.then(archiveStream =>
                                    archiveStream.pipe(new Collect()).collect()),
                                exports: archive.then(
                                    archiveStream => new Promise((resolve, reject) => {
                                        let found = false;
                                        archiveStream.pipe(new tar.Parse())
                                            .on('entry', entry => {
                                                console.debug("New entry!");
                                                if (entry.path === "exports/json") {
                                                    entry.pipe(new Collect()).collect()
                                                        .then(data => {
                                                            try {
                                                                resolve(JSON.parse(data));
                                                            } catch (e) {
                                                                reject(e);
                                                            }
                                                        });
                                                    found = true;
                                                } else {
                                                    entry.resume();
                                                }
                                            })
                                            .on('end', () => {
                                                if (!found) {
                                                    reject(new Error("No JSON export found"));
                                                }
                                                console.debug("parse end");
                                            })
                                            .on('abort', reject);
                                    })),
                            }).forEach((entry) => {
                                const [index, value] = entry;
                                console.debug("Order: ", index);
                                dataPromise = dataPromise.then(data => value.then(
                                    value => {
                                        data[index] = value;
                                        console.debug(index, "gathered");
                                        return data;
                                    },
                                    error => {
                                        console.warn(error);

                                        const errorData = {
                                            message: error.toString(),
                                            object: error,
                                        };

                                        if (error !== undefined) {
                                            errorData.stack = error.stack;
                                        }

                                        data[index + "Error"] = errorData;
                                        return data;
                                    }
                                ));
                            });

                            Promise.all([dataPromise, db]).then(([data, db]) =>
                                db.collection('setups').insertOne(data))
                                .then(res => console.debug("saved"));
                            dataPromise.then(data => setups.push(data), console.error);
                        }))
                    }));
                }));
            }));
        })();
    });
});

router.get('/:id', (req, res) => {
    res.render('shell', {
        title: "Setup log",
        socket: '/setups/' + req.params.id + '/' + req.query.property,
        autoBack: false,
    });
});

router.get('/:id/download', (req, res) => {
    const id = req.params.id;
    const property = req.query.property || "output";
    global.db.then(db => {
        const collection = db.collection('setups');
        const _id = MongoDB.ObjectID.isValid(id) ? new MongoDB.ObjectID(id) : id;
        return collection.findOne({_id: _id})
            .then(document => {
                if (document === null) {
                    res.status(404, 'No matching document found').render('error', {
                        title: "Not found", message: "404 No such setup ID",
                        techData: {id: id, type: _id.constructor.name},
                    });
                } else {
                    if (!document.hasOwnProperty(property)) {
                        res.status(410, "Property not saved").render('error', {
                            title: "Not saved", message: "410 Property not present",
                            techData: property,
                        });
                    } else {
                        let content = document[property], extension = "",
                            type = "application/octet-stream";
                        switch (property) {
                            case 'archive':
                                extension = '.tar';
                                type = 'application/tar';
                                break;

                            case 'input':
                            case 'output':
                                extension = '.txt';
                                type = 'text/plain';
                                break;

                            case property.endsWith('Error') ? property : false:
                            case 'exports':
                                extension = '.json';
                                type = 'application/json';
                                content = JSON.stringify(content);
                                break;
                        }
                        res.set('Content-Disposition',
                            `attachment; filename="${id}_${property}${extension}"`);
                        res.type(type);
                        res.send(content.toString());
                    }
                }
            });
    }, e => {
        socket.send("\033[J\033[31;1mError: Database connection failed\033[0m [500]\n");
        socket.send(e.stack);
    });
});

router.websocket('/:id/:property/:cols/:rows', ({req}, cb) => cb(socket => {
    const id = req.params.id;
    const property = req.params.property;
    socket.send("\033[JConnecting to database...\r");
    global.db.then(db => {
        socket.send("\033[JRetriving archive...\r");
        const collection = db.collection('setups');
        const _id = MongoDB.ObjectID.isValid(id) ? new MongoDB.ObjectID(id) : id;
        return collection.findOne({_id: _id}).then(document => {
            if (document === null) {
                socket.send("\033[J\033[31;1mError: No matching document found\033[0m [404]\n");
                socket.send("\033]9999;E_NODOC\033\\");
                socket.send(id + ' : ' + _id.constructor.name);
            } else {
                if (!document.hasOwnProperty(property)) {
                    socket.send("\033[J\033[31;1mError: Property not saved\033[0m [410]\n");
                    socket.send("\033]9999;E_NOPROP\033\\");
                    socket.send(property);
                } else {
                    socket.send("\033[J\033[32;1mSending data...\033[0m [200]\r");
                    socket.send("\033[J");
                    socket.send("\033]9999;DATA\033\\");
                    socket.send(document[property].toString());
                }
            }
            socket.close();
        });
    }, e => res.status(500, "Database connection error").render('error', {
        message: "Database connection failed", error: e,
    }));
}));

router.post('/:id/container/remove', (req, res) => {
    const id = req.params.id;
    const property = "container";
    global.db.then(db => {
        const collection = db.collection('setups');
        const _id = MongoDB.ObjectID.isValid(id) ? new MongoDB.ObjectID(id) : id;
        return collection.findOne({_id: _id}).then(document => {
            if (document === null) {
                res.status(404, 'No matching document found').render('error', {
                    title: "Not found", message: "404 No such setup ID",
                    techData: {id: id, type: _id.constructor.name},
                });
            } else {
                if (!document.hasOwnProperty(property)) {
                    res.status(410, "Property not saved").render('error', {
                        title: "Not saved", message: "410 Property not present",
                        techData: property,
                    });
                } else {
                    const containerId = document[property];
                    docker.getContainer(containerId).remove({})
                        .then(() => containers.erase(containerId))
                        .then(() => res.redirect('/setups'), (err) => {
                            res.status(500, "Operation failed").render('error', {
                                message: "Failed to remove container",
                                error: err, techData: containerId,
                            });
                        });
                }
            }
        });
    }, e => res.status(500, "Database connection error").render('error', {
        message: "Database connection failed", error: e,
    }));
});

router.post('/:id/delete', (req, res) => {
    const id = req.params.id;
    global.db.then(db => {
        const collection = db.collection('setups');
        const _id = MongoDB.ObjectID.isValid(id) ? new MongoDB.ObjectID(id) : id;
        // noinspection EqualityComparisonWithCoercionJS
        collection.deleteOne({_id: _id})
            .then(({result}) => {
                if (!result.n) throw new Error("Delete did not occur on any records");
                try {
                    setups.erase({_id: _id});
                } catch (e) {
                    console.error(e);
                }
                return result;
            })
            .then(() => res.redirect("/setups"), e => res.status(500).render('error', {
                message: "MongoDB delete failed", error: e,
                techData: id,
            }));
    }, e => res.status(500, "Database connection error").render('error', {
        message: "Database connection failed", error: e,
    }));
});

module.exports = router;