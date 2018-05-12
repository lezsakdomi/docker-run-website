const createError = require('http-errors');
const express = require('express');
const path = require('path');
const logger = require('morgan');
const stylus = require('stylus');
const session = require('express-session');
const passport = require('passport');

require('./modules/db').then(db => {
    const collection = db.collection("users");

    passport.serializeUser((user, done) => {
        collection.findOne({
            id: user.id,
            provider: user.provider,
        }).then(result => {
            if (result) {
                return result._id;
            } else {
                const key = user.provider + '::' + user.id;
                return collection.insertOne({
                    ...user,
                    _id: key,
                    dateRegistered: new Date(),
                }).then(() => key);
            }
        }).then(value => done(null, value), err => done(err));
    });

    passport.deserializeUser((string, done) => {
        collection.findOne({_id: string}).then(result => done(null, result), err => done(err));
    });
}, () => {
    passport.serializeUser((user, done) => done(null, JSON.stringify(user)));
    passport.deserializeUser((string, done) => done(null, JSON.parse(string)));
});

const expressWs = require('express-ws-routes');
const expressWsOptions = {};
const app = expressWs.extendExpress(expressWsOptions)();

// Hack for IDEA
if (1 === 2) {
    // noinspection JSUnusedLocalSymbols
    app.websocket = (path, f) => undefined;
}

const protect = require('./middlewares/protect');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
// noinspection JSUnresolvedFunction
app.use(stylus.middleware(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use(session({secret: 'keyboard cat'}));
app.use(passport.initialize({}));
app.use(passport.session({}));

app.use('/', require('./routes/index'));
app.use('/users', require('./routes/users'));
app.use('/auth', require('./routes/auth').multiRouter(
    'https://ledomi.duckdns.org:3443/auth',
    {
        successRedirect: '/',
        failureRedirect: '/auth',
        failureFlash: true,
    },
    require('passport')
));
app.use('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
});
app.use('/shell', require('./routes/shell'));
app.use('/info', protect.valid, (req, res) => {
    res.json(req.user);
});
app.use('/setups', require('./routes/setups'));
app.websocket('/echo', ({req}, cb) => cb(socket => socket.on('message',
    message => socket.send(message))));
app.websocket('/echo/s/:a/:b', ({req}, cb) => cb(socket => socket.on('message',
    message => socket.send(message.replace(req.params.a, req.params.b)))));
app.use('/customshell', (req, res) => {
    res.render('shell', req.query);
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
// noinspection JSUnusedLocalSymbols
app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = {
    app: app,
    expressWs: expressWs,
    expressWsOptions: expressWsOptions,
};
