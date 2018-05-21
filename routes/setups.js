const express = require('express');
const router = express.Router({});
const Docker = new require('dockerode');
const webscoketStream = require('websocket-stream');
const {Collect} = require('stream-collect');
const MongoDB = require('mongodb');
const tar = require('tar');
const protect = require('../middlewares/protect');
const EventedArray = require('array-events');

// Hack for IDEA
if (1 === 2) {
    // noinspection JSUnusedLocalSymbols
    router.post = router.websocket = (path, ...f) => undefined;
    // noinspection JSUnusedLocalSymbols
    MongoDB.ObjectID.isValid = MongoDB.ObjectId.isValid = string => undefined;
}

const image = 'server-setup';

const docker = new Docker();
const setups = new EventedArray();

// Hack for IDEA
if (1 === 2) {
    // noinspection JSUnusedLocalSymbols
    setups.slice = (from, to) => undefined;
    // noinspection JSUnusedLocalSymbols
    setups.combine = (otherArray) => undefined;
    // noinspection JSUnusedLocalSymbols
    setups.push = (...items) => undefined;
    // noinspection JSUnusedLocalSymbols
    setups.erase = filter => undefined;
    // noinspection JSUnusedLocalSymbols
    setups.on = setups.off = (event, f) => undefined;
}

function reloadSetups() {
    // noinspection JSUnresolvedFunction
    require('../modules/db').then(db => {
        db.collection('setups').find().sort({dateStarted: -1}).toArray().then(result => {
            setups.slice(0, 0);
            setups.combine(result);
        });
    });
}

const containers = new EventedArray();

function reloadContainers() {
    // noinspection JSCheckFunctionSignatures
    docker.listContainers({
        all: true,
        //TODO filter
    }).then(result => {
        containers.slice(0, 0);
        // noinspection JSUnresolvedVariable
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
    // noinspection JSUnresolvedFunction
    require('../modules/db').then(db => {
        const collection = db.collection('setups');
        collection.aggregate([
            {$lookup: {from: 'users', localField: 'user', foreignField: '_id', as: 'user'}},
            {$unwind: {path: "$user", preserveNullAndEmptyArrays: true}},
            {$sort: {dateStarted: -1}},
        ]).toArray().then(setups => res.render('setups', {
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
    cb(socket => {
        const ttry = f => {
            function fail(e) {
                try {
                    socket.send(JSON.stringify({
                        type: "error", message: e.toString(), stack: e.stack,
                    }));
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
            socket.send(JSON.stringify({
                type: "welcome",
            }));

            const containersChange = ttry(event => socket.send(JSON.stringify({
                type: "list-change", list: "containers", event: event,
            })));
            containers.on('change', containersChange);
            socket.on('close', () => {
                return containers.off(containersChange);
            });

            const setupsChange = ttry(event => socket.send(JSON.stringify({
                type: "list-change", list: "setups", event: event,
            })));
            setups.on('change', setupsChange);
            socket.on('close', () => setups.off(setupsChange));
        })();
    });
});

router.get('/new', (req, res) => {
    res.render('shell', {
        title: "New server setup",
        socket: '/setups/new' +
        (req.originalUrl.match(/\?/) ? '?' + req.originalUrl.split('?')[1] : ""),
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
                'Cmd': req.query.cmd ? req.query.cmd.split(" ") : undefined,
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

                    // Hack for IDEA
                    if (1 === 2) {
                        // noinspection JSUnusedLocalSymbols
                        remoteStream.pipe = stream => undefined;
                        // noinspection JSUnusedLocalSymbols
                        remoteStream.on = (event, f) => undefined;
                    }

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
                                user: req.user._id,
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
                                            })
                                            .on('abort', reject);
                                    })),
                            }).forEach((entry) => {
                                const [index, value] = entry;
                                dataPromise = dataPromise.then(data => value.then(
                                    value => {
                                        data[index] = value;
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

                            Promise.all([dataPromise, require('../modules/db')])
                                .then(([data, db]) => db.collection('setups').insertOne(data));
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
    // noinspection JSUnresolvedFunction
    require('../modules/db').then(db => {
        const collection = db.collection('setups');
        const _id = MongoDB.ObjectID.isValid(id) ? new MongoDB.ObjectID(id) : id;
        return collection.findOne({_id: _id})
            .then(document => {
                if (document === null) {
                    res.status(404).render('error', {
                        title: "Not found", message: "404 No such document in the database",
                        techData: {id: id, type: _id.constructor.name},
                    });
                } else {
                    if (!document.hasOwnProperty(property)) {
                        res.status(410).render('error', {
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
    // noinspection JSUnresolvedFunction
    require('../modules/db').then(db => {
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
    }, e => {
        socket.send("\033[J\033[31;1mError: Database connection failed\033[0m [500]\n");
        socket.send("\033]9999;E_DB\033\\");
        socket.send(e.stack);
    });
}));

router.post('/:id/container/remove', (req, res) => {
    const id = req.params.id;
    const property = "container";
    // noinspection JSUnresolvedFunction
    require('../modules/db').then(db => {
        const collection = db.collection('setups');
        const _id = MongoDB.ObjectID.isValid(id) ? new MongoDB.ObjectID(id) : id;
        return collection.findOne({_id: _id}).then(document => {
            if (document === null) {
                res.status(404).render('error', {
                    title: "Not found", message: "404 No matching document in the database",
                    techData: {id: id, type: _id.constructor.name},
                });
            } else {
                if (!document.hasOwnProperty(property)) {
                    res.status(410).render('error', {
                        title: "Not saved", message: "410 Property not present",
                        techData: property,
                    });
                } else {
                    const containerId = document[property];
                    docker.getContainer(containerId).remove({}, undefined)
                        .then(() => containers.erase(containerId))
                        .then(() => res.redirect('/setups'), (err) => {
                            res.status(500).render('error', {
                                message: "Failed to remove container",
                                error: err, techData: containerId,
                            });
                        });
                }
            }
        });
    }, e => res.status(500).render('error', {
        message: "Database connection failed", error: e,
    }));
});

router.post('/:id/delete', protect.superuser, (req, res) => {
    const id = req.params.id;
    // noinspection JSUnresolvedFunction
    require('../modules/db').then(db => {
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
    }, e => res.status(500).render('error', {
        message: "Database connection failed", error: e,
    }));
});

router.post('/:id/set', protect.superuser, (req, res) => {
    const id = req.params.id;
    // noinspection JSUnresolvedFunction
    require('../modules/db').then(db => {
        const collection = db.collection('setups');
        const _id = MongoDB.ObjectID.isValid(id) ? new MongoDB.ObjectID(id) : id;
        // noinspection EqualityComparisonWithCoercionJS
        try {
            collection.updateOne({_id: _id},
                {$set: {[req.body.property]: JSON.parse(req.body.value)}})
                .then(({result}) => {
                    if (!result.n) throw new Error("Update did not occur on any records");
                    return result;
                })
                .then(() => res.redirect("/setups"), e => res.status(500).render('error', {
                    message: "MongoDB update failed", error: e,
                    techData: id,
                }));
        } catch (e) {
            res.status(500).render('error', {
                message: "Semantic error", error: e,
                techData: req.body,
            });
        }
    }, e => res.status(500).render('error', {
        message: "Database connection failed", error: e,
    }));
});

module.exports = router;
