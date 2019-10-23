var express = require('express');
var path = require('path');
var logger = require('morgan');
const bodyParser = require('body-parser');
var OauthServer = require('express-oauth-server');
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

// Add OAuth server.
app.oauth = new OauthServer({
    model: require('./model')
});

const User = Models.User;
const Transfer = Models.Transfer;
const Withdrawal = Models.Withdrawal;


var systemUserEthereumAccount;//TODO make it an eth account

var chainId = '0x4';//TODO: get it from env
var tokenContract = new web3.eth.Contract(require('./ERC20ABI.json'), process.env.TOKEN_ADDRESS);


app.post('/transfer', app.oauth.authenticate({scope:'TRANSFER'}), async (req, res) => // TODO: handle security
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
            await Transfer.build({
                amount: req.body.amount,
                receiverId: req.body.receiverId,
                senderId: req.body.senderId
            }).save();
            var response = {status: 'ok'};
            res.send(JSON.stringify(response));
        });
    }//TODO: add transfer event

});

app.post('/initializeDepositAddress', app.oauth.authenticate({scope:'INITIALIZE_DEPOSIT_ADDRESS'}), async (req, res) => // TODO: handle security
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

app.post('/withdraw', app.oauth.authenticate({scope:'WITHDRAW'}), async (req, res) => // TODO: handle security & use logger
        // TODO: do it all in a single transaction for safety
    {
        console.log(req.body);
        if (req.body.amount <= process.env.WITHDRAWAL_FEE_IN_TOKENS) {
            res.send(JSON.stringify({error: `amount must be higher than the fee ${process.env.WITHDRAWAL_FEE_IN_TOKENS}`}))
        }
        var user = await User.findByPk(req.body.senderId);
        // console.log(user);
        if (user != null) {
            if (req.body.amount <= user.balance) {
                let amountWithDecimalsAfterFee = (req.body.amount - process.env.WITHDRAWAL_FEE_IN_TOKENS).toFixed(8) * (10 ** 8);

                let nonce = await web3.eth.getTransactionCount(systemUserEthereumAccount.address);

                const txParams = {
                    gasLimit: web3.utils.toHex(51595),
                    chainId: chainId,
                    to: process.env.TOKEN_ADDRESS,
                    gasPrice: web3.utils.toHex(await web3.eth.getGasPrice()),
                    nonce: web3.utils.toHex(nonce),
                    value: '0x00',
                    data: tokenContract.methods.transfer(req.body.address, amountWithDecimalsAfterFee).encodeABI()
                };
                var signedTransaction = await systemUserEthereumAccount.signTransaction(txParams); //TODO: better use web3.eth.accounts.signTransaction
                web3.eth.sendSignedTransaction(signedTransaction.rawTransaction).once('transactionHash', async function (hash) {
                    console.log('tx_hash:' + hash)
                    user.balance = parseFloat(user.balance) - req.body.amount;
                    user.save();
                    var feeCollectorUser = await User.findByPk(Models.Constants.FEE_COLLECTOR_USER_ID);
                    feeCollectorUser.balance = feeCollectorUser.balance + parseFloat(process.env.WITHDRAWAL_FEE_IN_TOKENS); // TODO: do this in a single transaction
                    feeCollectorUser.save();
                    await Transfer.build({
                        amount: process.env.WITHDRAWAL_FEE_IN_TOKENS,
                        receiverId: feeCollectorUser.userId,
                        senderId: req.body.senderId
                    }).save();
                    Withdrawal.build({
                        transactionHash: hash,
                        amount: req.body.amount,
                        address: req.body.address,
                        senderId: req.body.senderId
                    }).save().then(withdrawal => {
                        res.send(JSON.stringify({transaction_hash: hash, withdrawalId: withdrawal.withdrawalId}))
                    });


                });
            } else {
                res.send(JSON.stringify({error: 'not enough balance'}))
            }
        } else {
            res.send(JSON.stringify({error: 'user not found'})) // TODO: nicer handling of such cases
        }

    }
);

// Get token.
app.post('/oauth/token', app.oauth.token());

app.get('/', (req, res) =>
    {
        res.send('Wallet Service Works!');

    }
);

async function run (){

    var systemUser = await User.findByPk(Models.Constants.SYSTEM_USER_ID);

    var systemUserPrivateKey = AES.decrypt(systemUser.depositPrivateKey, keyBase64,ivBase64);

    systemUserEthereumAccount = web3.eth.accounts.privateKeyToAccount(systemUserPrivateKey);

    app.listen(process.env.PORT, () => console.log(`Wallet Service listening on port ${process.env.PORT}!`));
}

run();

