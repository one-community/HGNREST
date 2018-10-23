let jwt = require('jsonwebtoken');
let config = require('../config');
let moment = require('moment');

module.exports = function(app)
{
    app.all('*', function (req, res, next) {

        console.log(` Service called Url: ${req.originalUrl}, Method : ${req.method}`);
    
        if (req.originalUrl == "/") {
            res.status(200).send("This is the homepage for rest services");
            return;
        }
    
        if ((req.originalUrl == "/api/login" || req.originalUrl == "/api/forgotpassword" ) && req.method == "POST") { next(); return; }
        if(req.originalUrl == "/api/forcepassword" && req.method == "PATCH" ){next(); return;}
        if (!req.header("Authorization")) {
            res.status(401).send({ "error:": "Unauthorized request" });
            return;
        }
    
        let authToken = req.header(config.REQUEST_AUTHKEY);
    
        let payload = "";
    
        try {
            payload = jwt.verify(authToken, process.env.JWT_SECRET);
    
        }
        catch (error) {
            res.status(401).send("Invalid token");
            return;
    
        }
    
        if (!payload || !payload.expiryTimestamp || !payload.userid || !payload.role ||
            moment().isAfter(payload.expiryTimestamp)) {
            res.status(401).send("Unauthorized request");
            return;
        }
    
        let requestor = {};
        requestor.requestorId = payload.userid;
        requestor.role = payload.role;
        req.body.requestor = requestor;
        next();
    });
}