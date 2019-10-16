var express = require('express');
var path = require('path');
var logger = require('morgan');
const bodyParser = require('body-parser');
const Models = require('@narcis2007/ipour-models');
const Web3 = require('web3');
const AES = require('aes-cbc');

var ivBase64 = 'AcynMwikMkW4c7+mHtwtfw==';
var keyBase64 = "OWxkdDc0SGJwWUhFa2VQTm0wcThReFNJeGRuZkpXaU8="; //TODO: get the key from env

const web3 = new Web3(new Web3.providers.HttpProvider('https://rinkeby.infura.io/v3/3d1dacbcaeb34ea889ae105c15220e08'));
const sequelize = Models.sequelize;

Models.syncDB(false);

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({
    extended: true
}));

app.use(bodyParser.json());

const User = Models.User;
const Transfer = Models.Transfer;

app.post('/transfer', async (req, res) => // TODO: handle security
{
    // oare merita sa fac unul dedicat pentru a transfera de la sys acc la un alt user cand primim bani in banca? -> trebuie sa vad cum facem cu securitatea

    var fromUser = await User.findByPk(req.body.senderId);
    var receiverUser = await User.findByPk(req.body.receiverId);
    if (fromUser.balance < req.body.amount) {
        res.send('error: not enough balance!')
    } else {
        sequelize.transaction(async function (t) {
            fromUser.balance -= req.body.amount;
            await fromUser.save();
            receiverUser.balance += req.body.amount;
            await receiverUser.save();
            var response = {status: 'ok'};
            res.send(JSON.stringify(response));
        });
    }

});

app.post('/initializeDepositAddress', async (req, res) => // TODO: handle security
    {
        var user = await User.findByPk(req.body.userId);
        if(user.depositAddress == null && user.depositPrivateKey == null){
            var ethereumAccount = web3.eth.accounts.create();
            user.depositAddress = ethereumAccount.address;
            user.depositPrivateKey = AES.encrypt(ethereumAccount.privateKey, keyBase64, ivBase64);

            await user.save();

            var response = {status: 'ok'};
            res.send(JSON.stringify(response));
        } else {
            var response = {error: 'user was already initialized'};
            res.send(JSON.stringify(response));
        }


    }
);

app.listen(port, () => console.log(`Wallet Service listening on port ${port}!`))

