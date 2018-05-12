const express = require('express');
const router = express.Router({});

router.use(require('../middlewares/protect'));

router.all('/', function (req, res, next) {
    require('../modules/db').then(db => {
        const collection = db.collection('users');
        collection.find()
            .toArray()
            .then(users => res.render('users', {
                title: "Manage users", users: users,
            }), next);
    }, err => res.status(500).render('error', {
        title: "Database error",
        message: "Failed to connect to database", error: err
    }));
});

router.all('/:id', (req, res, next) => {
    const id = req.params.id;
    const query = {_id: id};
    require('../modules/db').then(db => {
        const collection = db.collection("users");
        collection.findOne(query).then(result => {
            if (result) {
                if (req.body.action) {
                    switch (req.body.action) {
                        case "delete":
                            collection.deleteOne(query)
                                .then(() => res.redirect('/users/'), next);
                            break;

                        case "permit":
                            collection.updateOne(query, {$set: {privileged: true}})
                                .then(() => res.redirect('/users/'), next);
                            break;

                        case "deny":
                            collection.updateOne(query, {$set: {privileged: false}})
                                .then(() => res.redirect('/users/'), next);
                            break;

                        default:
                            res.status(400).render('error', {
                                title: "User management",
                                message: "Unknown action",
                                error: new Error("Unknown action '" + req.body.action + "'")
                            });
                    }
                } else {
                    res.json(result);
                }
            } else {
                next();
            }
        }, next);
    }, err => res.status(500).render('error', {
        title: "Database error",
        message: "Failed to connect to database", error: err
    }));
});

module.exports = router;
