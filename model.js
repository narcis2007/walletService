const Models = require('@narcis2007/ipour-models');

const Client = Models.Oauth.Client;
const Scope = Models.Oauth.Scope;
const Token = Models.Oauth.Token;


/*
 * Get access token.
 */

module.exports.getAccessToken = function (token) {
    return Token.findAll({
        where: {
            accessToken: token
        },
        include: [{
            model: Client,
            attributes: ['clientId']
        }],
    }).then(function (result) {
        var token = result[0];
        // TODO: if it is not found throw a nicer error or something or an empty object
        return {
            accessToken: token.accessToken,
            client: {id: token.client.clientId},
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            user: {}, //id: token.userId could be any object
        };
    });
};

/**
 * Get client.
 */

module.exports.getClient = function* (clientId, clientSecret) {
    return Client.findAll({
        where: {
            clientId: clientId,
            clientSecret: clientSecret
        }
    }).then(function (result) {
        var oAuthClient = result[0];

        if (!oAuthClient) {
            return;
        }

        return {
            clientId: oAuthClient.clientId,
            clientSecret: oAuthClient.clientSecret,
            grants: ['client_credentials'], // the list of OAuth2 grant types that should be allowed
        };
    });
};

/**
 * Save token.
 */

module.exports.saveToken = function* (token, client, user) {
    var oauthToken = Token.build(token);
    oauthToken.setClient(client.clientId);
    return oauthToken.save().then(function (result) {
        return {
            accessToken: token.accessToken,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            refreshToken: token.refreshToken,
            refreshTokenExpiresAt: token.refreshTokenExpiresAt,
            client: client,
            user: user
        };
    });
};

module.exports.verifyScope = function (token, scope) {
    return Token.findAll({
        where: {
            accessToken: token.accessToken
        },
        include: [{
            model: Client,
            include: [{
                model: Scope
            }],
        }],
    }).then(oauthToken => {
        var scopes = oauthToken[0].client.scopes;
        var found = false;
        for (let i = 0; i < scopes.length; i++) {
            if (scopes[i].scope == scope)
                found = true;
        }

        return found;
    });
}

module.exports.getUserFromClient = function* (username, password) {
    return {};
};


