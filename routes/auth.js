const express = require('express');

// IDEA hack
if (1 === 2) {
    // noinspection JSUnusedLocalSymbols
    const router = {};
    router.get = () => undefined;
    router.use = () => undefined;
}

module.exports = {};

function providerRouter(provider, details, authDetails) {
    return (base, authOptions = {}, passport = require('passport'),
            router = express.Router({})) => {
        let moduleName, moduleProperty;
        if (provider.match(/\./)) {
            const parts = provider.split('.');
            console.assert(parts.length === 2);
            moduleName = parts[0];
            moduleProperty = parts[1];
        } else {
            moduleName = provider;
            moduleProperty = 'Strategy';
        }

        const Strategy = require('passport-' + moduleName)[moduleProperty];

        const strategy = new Strategy({
            callbackURL: base + '/callback',
            ...details
        }, (accessToken, refreshToken, profile, done) => done(null, profile));

        const strategyName = strategy.name;

        passport.use(strategyName, strategy);

        router.get('/', passport.authenticate(strategyName, authDetails, null));

        router.get('/callback', passport.authenticate(strategyName, authOptions, null));

        router.passport = passport;

        return router;
    };
}

// noinspection SpellCheckingInspection
module.exports.googleRouter = providerRouter('google-oauth.OAuth2Strategy', {
    clientID: '413034108236-o46jeqpate9769jbt6ioi69quuqluq26.apps.googleusercontent.com',
    clientSecret: 'el3rt-ye7AIHYO-ApTe-9pBe',
}, {scope: ['https://www.googleapis.com/auth/plus.login']});

module.exports.facebookRouter = providerRouter('facebook', {
    clientID: '167153570638709',
    clientSecret: '9855dfc9cf38f118a6f1e46f0fe5262f',
}, null);

// noinspection SpellCheckingInspection
module.exports.twitterRouter = providerRouter('twitter', {
    consumerKey: '4RfMxRmdWxFai0x725ZeArJVI',
    consumerSecret: 'GAhBWvJmX1jKEXItY9JdaOxFDMqnW1Cs7ImthSDEhVAtj3AY6o',
}, null);

module.exports.multiRouter = (base, authOptions = {}, passport = require('passport'), router =
    express.Router({})) => {
    const providers = [
        'google',
        'facebook',
        'twitter',
    ];

    for (let provider of providers) {
        router.use('/' + provider, module.exports[provider + 'Router'](
            base + '/' + provider,
            authOptions,
            passport
        ));
    }

    router.get('/', (req, res) => {
        res.render('auth', {
            title: "Authentication",
            authProviders: providers,
            base: base
        })
    });

    router.passport = passport;

    return router;
};