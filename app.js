var express = require('express');
var path = require('path');
var logger = require('morgan');
const bodyParser = require('body-parser');
var OauthServer = require('express-oauth-server');
const Models = require('@narcis2007/ipour-models');
const Web3 = require('web3');
const AES = require('aes-cbc');

var ivBase64 = 'AcynMwikMkW4c7+mHtwtfw==';
var keyBase64 = process.env.KEY;

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_PROVIDER));
const sequelize = Models.sequelize;

Models.syncDB(false);

const app = express();

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


var systemUserEthereumAccount;
const tokenAddress = process.env.TOKEN_ADDRESS;
const tokenContract = new web3.eth.Contract(require('./ERC20ABI.json'), tokenAddress);

const withdrawalFeeInTokens = process.env.WITHDRAWAL_FEE_IN_TOKENS;
const paymentFeePercentage = process.env.PAYMENT_FEE_PERCENTAGE;
const chainId = process.env.CHAIN_ID;

function transfer(senderId, receiverId, amount, feePercentage, res){
    sequelize.transaction(async function (t) {
        var fromUser = await User.findByPk(senderId, {transaction: t});
        var feeCollectorUser = await User.findByPk(Models.Constants.FEE_COLLECTOR_USER_ID, {transaction: t}); // TODO: handle fee and test!!
        var receiverUser = await User.findByPk(receiverId, {transaction: t});

        var fee = 0;
        fee += (amount * feePercentage) / 100; //TODO: expose api for get fee for amount paid
        if (fromUser.balance < amount + fee) {
            res.send( 'error: not enough balance!');
        } else {
            fromUser.balance -= amount + fee;
            await fromUser.save({transaction: t});
            receiverUser.balance += amount;
            await receiverUser.save({transaction: t});
            await Transfer.build({
                amount: amount,
                receiverId: receiverId,
                senderId: senderId
            }).save({transaction: t});

            if(fee !=0){
                feeCollectorUser.balance += fee;
                await feeCollectorUser.save({transaction: t});
                await Transfer.build({
                    amount: fee,
                    receiverId: feeCollectorUser.userId,
                    senderId: senderId
                }).save({transaction: t});
            }

            var response = {status: 'ok'};
            res.send(JSON.stringify(response));
        }
    });
}

app.post('/issueTokens', app.oauth.authenticate(), async (req, res) =>//{scope:'TRANSFER'}
{
    transfer(Models.Constants.SYSTEM_USER_ID, req.body.receiverId, req.body.amount, 0, res);
});

app.post('/pay', app.oauth.authenticate(), async (req, res) => // {scope:'TRANSFER'} // TODO create a shared function between this and transfer
{
    transfer(req.body.senderId, req.body.receiverId, req.body.amount, paymentFeePercentage, res);

});

app.post('/initializeDepositAddress', app.oauth.authenticate(), async (req, res) => // {scope:'INITIALIZE_DEPOSIT_ADDRESS'}
    {
        var user = await User.findByPk(req.body.userId);
        if (user.depositAddress == null && user.depositPrivateKey == null) {
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

app.post('/withdraw', app.oauth.authenticate(), async (req, res) => // TODO: use logger {scope:'WITHDRAW'}
        // TODO: do it all in a single transaction for safety
    {
        console.log(req.body);

        if (req.body.amount <= withdrawalFeeInTokens) {
            res.send(JSON.stringify({error: `amount must be higher than the fee ${withdrawalFeeInTokens}`}))
        }
        var user = await User.findByPk(req.body.senderId);
        // console.log(user);
        if (user != null) {
            if (req.body.amount <= user.balance) {
                let amountWithDecimalsAfterFee = (req.body.amount - withdrawalFeeInTokens).toFixed(8) * (10 ** 8);

                let nonce = await web3.eth.getTransactionCount(systemUserEthereumAccount.address);

                const txParams = {
                    gasLimit: web3.utils.toHex(51595),
                    chainId: chainId,
                    to: tokenAddress, //TODO: extract these in global variables instead of retrieving all over the place
                    gasPrice: web3.utils.toHex(await web3.eth.getGasPrice()),
                    nonce: web3.utils.toHex(nonce),
                    value: '0x00',
                    data: tokenContract.methods.transfer(req.body.address, amountWithDecimalsAfterFee).encodeABI()
                };
                var signedTransaction = await systemUserEthereumAccount.signTransaction(txParams);
                web3.eth.sendSignedTransaction(signedTransaction.rawTransaction).once('transactionHash', async function (hash) {
                    console.log('tx_hash:' + hash)
                    user.balance = parseFloat(user.balance) - req.body.amount;
                    user.save();
                    var feeCollectorUser = await User.findByPk(Models.Constants.FEE_COLLECTOR_USER_ID);
                    feeCollectorUser.balance = feeCollectorUser.balance + parseFloat(withdrawalFeeInTokens); // TODO: do this in a transaction
                    feeCollectorUser.save();
                    await Transfer.build({
                        amount: withdrawalFeeInTokens,
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

app.get('/', (req, res) => {
        res.send('Wallet Service Works!');

    }
);

async function run() {

    var systemUser = await User.findByPk(Models.Constants.SYSTEM_USER_ID);

    var systemUserPrivateKey = AES.decrypt(systemUser.depositPrivateKey, keyBase64, ivBase64);

    systemUserEthereumAccount = web3.eth.accounts.privateKeyToAccount(systemUserPrivateKey);

    app.listen(process.env.PORT, () => console.log(`Wallet Service listening on port ${process.env.PORT}!`));
}

run();

