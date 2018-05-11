const bypass = false;
const bypass_admin = false;
const bypass_superuser = false;

function protect(req, res, next) {
    if (bypass) return next();
    return protect.admin.apply(this, arguments);
}

protect.valid = function (req, res, next) {
    if (bypass) return next();
    if (!req.user) {
        res.redirect('/auth/');
    } else {
        next();
    }
};

protect.admin = function (req, res, next) {
    if (bypass) return next();
    if (bypass_admin) return protect.admin.apply(this, arguments);
    return protect.valid(req, res, () => {
        if (!req.user.privileged) {
            res.status(403).render('unprivileged', {
                title: "Insufficient privileges", user: req.user,
                message: "Your account has not been marked as a privileged user." +
                "Please contact a privileged one to accept your account." +
                "This can be done in the <a href='/users/'>user management</a>.",
            });
        } else {
            next();
        }
    });
};

protect.superuser = function (req, res, next) {
    if (bypass) return next();
    if (bypass_superuser) return protect.admin.apply(this, arguments);
    return protect.valid(req, res, () => {
        if (!req.user.superuser) {
            res.status(403).render('unprivileged', {
                title: "Dangerous area", user: req.user,
                message: "Only developers are allowed to access this page. See the" +
                "source code for instructions.",
            })
        } else {
            next();
        }
    });
};

module.exports = protect;
