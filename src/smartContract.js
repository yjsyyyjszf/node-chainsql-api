"use strict";

const _ = require('lodash');
const path = require('path');
var chainsqlUtils = require('chainsql-lib').ChainsqlLibUtil;
var abi = require('web3-eth-abi');
var utils = require('web3-utils');
var formatters = require('web3-core-helpers').formatters;

/**
 * Contract constructor for creating new contract instance
 *
 * @method Contract
 * @constructor
 * @param {Array} jsonInterface
 * @param {String} address
 * @param {Object} options
 */
var Contract = function Contract(chainsql, jsonInterface, address, options) {
	var _this = this,
		args = Array.prototype.slice.call(arguments);

	this.chainsql = chainsql;
	this.connect = chainsql.connect;

	if(!(this instanceof Contract)) {
		throw new Error('Please use the "new" keyword to instantiate a chainsql contract() object!');
	}

	// sets _requestmanager
	//core.packageInit(this, [this.constructor.currentProvider]);

	//this.clearSubscriptions = this._requestManager.clearSubscriptions;

	if(!jsonInterface || !(Array.isArray(jsonInterface))) {
		throw new Error('You must provide the json interface of the contract when instantiating a contract object.');
	}

	// create the options object
	this.options = {};

	// var lastArg = args[args.length - 1];
	// if(_.isObject(lastArg) && !_.isArray(lastArg)) {
	//     options = lastArg;

	//     this.options = _.extend(this.options, this._getOrSetDefaultOptions(options));
	//     if(_.isObject(address)) {
	//         address = null;
	//     }
	// }

	// set address
	Object.defineProperty(this.options, 'address', {
		set: function(value){
			if(value) {
				//_this._address = utils.toChecksumAddress(formatters.inputAddressFormatter(value));
				_this._address = value;//may add a addr validation check like above;
			}
		},
		get: function(){
			return _this._address;
		},
		enumerable: true
	});

	// add method and event signatures, when the jsonInterface gets set
	Object.defineProperty(this.options, 'jsonInterface', {
		set: function(value){
			_this.methods = {};
			_this.events = {};

			_this._jsonInterface = value.map(function(method) {
				var func,
					funcName;

				if (method.name) {
					funcName = utils._jsonInterfaceMethodToString(method);
				}

				// function
				if (method.type === 'function') {
					method.signature = abi.encodeFunctionSignature(funcName);
					func = _this._createTxObject.bind({
						method: method,
						parent: _this
					});

					// add method only if not one already exists
					if(!_this.methods[method.name]) {
						_this.methods[method.name] = func;
					} else {
						var cascadeFunc = _this._createTxObject.bind({
							method: method,
							parent: _this,
							nextMethod: _this.methods[method.name]
						});
						_this.methods[method.name] = cascadeFunc;
					}

					// definitely add the method based on its signature
					_this.methods[method.signature] = func;

					// add method by name
					_this.methods[funcName] = func;
					// event
				} else if (method.type === 'event') {
					method.signature = abi.encodeEventSignature(funcName);
					var event = _this._on.bind(_this, method.signature);

					// add method only if not already exists
					if(!_this.events[method.name] || _this.events[method.name].name === 'bound ')
						_this.events[method.name] = event;

					// definitely add the method based on its signature
					_this.events[method.signature] = event;
					//_this.events[method.signature] = method;

					// add event by name
					_this.events[funcName] = event;
				}
				return method;
			});

			// add allEvents
			//_this.events.allEvents = _this._on.bind(_this, 'allevents');
			return _this._jsonInterface;
		},
		get: function(){
			return _this._jsonInterface;
		},
		enumerable: true
	});

	// get default account from the Class
	// var defaultAccount = this.constructor.defaultAccount;
	// var defaultBlock = this.constructor.defaultBlock || 'latest';

	// Object.defineProperty(this, 'defaultAccount', {
	//     get: function () {
	//         return defaultAccount;
	//     },
	//     set: function (val) {
	//         if(val) {
	//             defaultAccount = utils.toChecksumAddress(formatters.inputAddressFormatter(val));
	//         }

	//         return val;
	//     },
	//     enumerable: true
	// });
	// Object.defineProperty(this, 'defaultBlock', {
	//     get: function () {
	//         return defaultBlock;
	//     },
	//     set: function (val) {
	//         defaultBlock = val;

	//         return val;
	//     },
	//     enumerable: true
	// });

	// properties
	this.methods = {};
	this.events = {};

	this._address = null;
	this._jsonInterface = [];

	// set getter/setter properties
	this.options.address = address;
	this.options.jsonInterface = jsonInterface;
};

/**
 * Use default values, if options are not available
 *
 * @method _getOrSetDefaultOptions
 * @param {Object} options the options gived by the user
 * @return {Object} the options with gaps filled by defaults
 */
Contract.prototype._getOrSetDefaultOptions = function getOrSetDefaultOptions(options) {
	var gasPrice = options.gasPrice ? String(options.gasPrice): null;
	var from = options.from ? utils.toChecksumAddress(formatters.inputAddressFormatter(options.from)) : null;

	options.data = options.data || this.options.data;

	options.from = from || this.options.from;
	options.gasPrice = gasPrice || this.options.gasPrice;
	options.gas = options.gas || options.gasLimit || this.options.gas;

	// TODO replace with only gasLimit?
	delete options.gasLimit;

	return options;
};

/**
 * Should be used to encode indexed params and options to one final object
 *
 * @method _encodeEventABI
 * @param {Object} event
 * @param {Object} options
 * @return {Object} everything combined together and encoded
 */
Contract.prototype._encodeEventABI = function (event, options) {
	options = options || {};
	var filter = options.filter || {},
		result = {};

	['fromBlock', 'toBlock'].filter(function (f) {
		return options[f] !== undefined;
	}).forEach(function (f) {
		result[f] = formatters.inputBlockNumberFormatter(options[f]);
	});

	// use given topics
	if(_.isArray(options.topics)) {
		result.topics = options.topics;

		// create topics based on filter
	} else {

		result.topics = [];

		// add event signature
		if (event && !event.anonymous && event.name !== 'ALLEVENTS') {
			result.topics.push(event.signature);
		}

		// add event topics (indexed arguments)
		if (event.name !== 'ALLEVENTS') {
			var indexedTopics = event.inputs.filter(function (i) {
				return i.indexed === true;
			}).map(function (i) {
				var value = filter[i.name];
				if (!value) {
					return null;
				}

				// TODO: https://github.com/ethereum/web3.js/issues/344

				if (_.isArray(value)) {
					return value.map(function (v) {
						return abi.encodeParameter(i.type, v);
					});
				}
				return abi.encodeParameter(i.type, value);
			});

			result.topics = result.topics.concat(indexedTopics);
		}

		if(!result.topics.length)
			delete result.topics;
	}

	if(this.options.address) {
		result.address = this.options.address.toLowerCase();
	}

	return result;
};

/**
 * Should be used to decode indexed params and options
 *
 * @method _decodeEventABI
 * @param {Object} data
 * @return {Object} result object with decoded indexed && not indexed params
 */
Contract.prototype._decodeEventABI = function (currentEvent, data) {
	//var event = this;
	var event = currentEvent;

	data.data = data.ContractEventInfo || '';
	data.topics = data.ContractEventTopics || [];
	var result = formatters.outputLogFormatter(data);

	// if allEvents get the right event
	if(event.name === 'ALLEVENTS') {
		event = event.jsonInterface.find(function (intf) {
			return (intf.signature === data.topics[0]);
		}) || {anonymous: true};
	}

	// create empty inputs if none are present (e.g. anonymous events on allEvents)
	event.inputs = event.inputs || [];

	var argTopics = event.anonymous ? data.topics : data.topics.slice(1);

	result.returnValues = abi.decodeLog(event.inputs, data.data, argTopics);
	delete result.returnValues.__length__;

	// add name
	result.event = event.name;

	// add signature
	result.signature = (event.anonymous || !data.topics[0]) ? null : data.topics[0];

	// move the data and topics to "raw"
	result.raw = {
		data: result.data,
		topics: result.topics
	};
	delete result.data;
	delete result.topics;

	return result;
};

/**
 * Encodes an ABI for a method, including signature or the method.
 * Or when constructor encodes only the constructor parameters.
 *
 * @method _encodeMethodABI
 * @param {Mixed} args the arguments to encode
 * @param {String} the encoded ABI
 */
Contract.prototype._encodeMethodABI = function _encodeMethodABI() {
	var methodSignature = this._method.signature,
		args = this.arguments || [];

	var signature = false,
		paramsABI = this._parent.options.jsonInterface.filter(function (json) {
			return ((methodSignature === 'constructor' && json.type === methodSignature) ||
                ((json.signature === methodSignature || json.signature === methodSignature.replace('0x','') || json.name === methodSignature) && json.type === 'function'));
		}).map(function (json) {
			var inputLength = (_.isArray(json.inputs)) ? json.inputs.length : 0;

			if (inputLength !== args.length) {
				throw new Error('The number of arguments is not matching the methods required number. You need to pass '+ inputLength +' arguments.');
			}

			if (json.type === 'function') {
				signature = json.signature;
			}
			return _.isArray(json.inputs) ? json.inputs.map(function (input) { return input.type; }) : [];
		}).map(function (types) {
			return abi.encodeParameters(types, args).replace('0x','');
		})[0] || '';

	// return constructor
	if(methodSignature === 'constructor') {
		if(!this._deployData)
			throw new Error('The contract has no contract data option set. This is necessary to append the constructor parameters.');

		return this._deployData + paramsABI;
		// return method
	} else {
		var returnValue = (signature) ? signature + paramsABI : paramsABI;

		if(!returnValue) {
			throw new Error('Couldn\'t find a matching contract method named "'+ this._method.name +'".');
		} else {
			return returnValue;
		}
	}
};

/**
 * Decode method return values
 *
 * @method _decodeMethodReturn
 * @param {Array} outputs
 * @param {String} returnValues
 * @return {Object} decoded output return values
 */
Contract.prototype._decodeMethodReturn = function (outputs, returnValues) {
	if (!returnValues) {
		return null;
	}

	returnValues = returnValues.length >= 2 ? returnValues.slice(2) : returnValues;
	var result = abi.decodeParameters(outputs, returnValues);

	if (result.__length__ === 1) {
		return result[0];
	} else {
		delete result.__length__;
		return result;
	}
};

/**
 * Deploys a contract and fire events based on its state: transactionHash, receipt
 *
 * All event listeners will be removed, once the last possible event is fired ("error", or "receipt")
 *
 * @method deploy
 * @param {Object} options
 * @param {Function} callback
 * @return {Object} EventEmitter possible events are "error", "transactionHash" and "receipt"
 */
Contract.prototype.deploy = function(options, callback){
	let connect = this.connect;
	let contractData = options.ContractData.length >= 2 ? options.ContractData.slice(2) : options.ContractData;
	let deployPayment = {
		TransactionType : "Contract",
		ContractOpType  : 1,
		Account : connect.address,
		ContractValue :options.ContractValue,
		Gas : options.Gas,
		ContractData : contractData.toUpperCase()
	};

	if ((typeof callback) != 'function') {
		let this_ = this;
		return new Promise(function(resolve, reject){
			executeDeployPayment(this_, deployPayment, callback, resolve, reject);
		});
	}
	else{
		executeDeployPayment(this, deployPayment, callback, null, null);
	}
};

function executeDeployPayment(contractObj, deployPayment, callback, resolve, reject){
	let chainSQL = contractObj.chainsql;
	var errFunc = function(error) {
		if ((typeof callback) == 'function') {
			callback(error, null);
		} else {
			reject(error);
		}
	};
	prepareDeployPayment(chainSQL, deployPayment).then(data => {
		let signedRet = chainSQL.api.sign(data.txJSON, chainSQL.connect.secret);
		handleDeployTx(contractObj, signedRet, callback, resolve, reject);
	}).catch(err => {
		errFunc(err);
	});
}
function prepareDeployPayment(chainSQL, depolyPayment){
	var instructions = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];
	const txJSON = createDeployPaymentTx(depolyPayment);
	return chainsqlUtils.prepareTransaction(txJSON, chainSQL.api, instructions);
}
function createDeployPaymentTx(deployPayment){
	var newDeployPayment = _.cloneDeep(deployPayment);

	var txJSON = {
		TransactionType : newDeployPayment.TransactionType,
		ContractOpType  : newDeployPayment.ContractOpType,
		Account : newDeployPayment.Account,
		ContractValue : newDeployPayment.ContractValue,
		ContractData : newDeployPayment.ContractData,
		Gas : newDeployPayment.Gas
	};
	return txJSON;
}
function handleDeployTx(contractObj, signedVal, callback, resolve, reject){
	let chainSQL = contractObj.chainsql;
	var isFunction = false;
	if ((typeof callback) == 'function')
		isFunction = true;
	
	var errFunc = function(error) {
		if (isFunction) {
			callback(error, null);
		} else {
			reject(error);
		}
	};
	// var exceptFunc = function(exception){
	// 	if (isFunction) {
	// 		object(exception, null);
	// 	} else {
	// 		reject(exception);
	// 	}
	// }
	var sucFunc = function(data){
		if(isFunction){
			callback(null,data);
		}else{
			resolve(data);
		}
	};
	// subscribe event
	chainSQL.event.subscribeTx(signedVal.id, async function(err, data) {
		if (err) {
			errFunc(err);
		} else {
			// success
			// if 'submit()' called without param, default is validate_success
			if (data.status === 'validate_success' && data.type === 'singleTransaction') {
				let contractAddr = await getContractAddr(chainSQL, data.transaction.hash);
				if (contractAddr === "") {
					errFunc({
						status: data.status,
						tx_hash: data.transaction.hash,
						contractAddress: "Can not find CreateNode"
					});
				}
				else {
					contractObj.options.address = contractAddr;
					sucFunc({
						status: data.status,
						tx_hash: data.transaction.hash,
						contractAddress: contractAddr
					});
				}
			}
			// failure
			if (data.status == 'db_error' 
				|| data.status == 'db_timeout' 
				|| data.status == 'validate_timeout') {
				errFunc({
					status: data.status,
					tx_hash: data.transaction.hash,
					error_message: data.error_message
				});
			}
		}
	}).then(function(data) {
		// subscribeTx success
	}).catch(function(error) {
		// subscribeTx failure
		errFunc('subscribeTx exception.' + error);
	});
	
	// submit transaction
	chainSQL.api.submit(signedVal.signedTransaction).then(function(result) {
		//console.log('submit ', JSON.stringify(result));
		if (result.resultCode !== 'tesSUCCESS') {
			chainSQL.event.unsubscribeTx(signedVal.id).then(function(data) {
				// unsubscribeTx success
			}).catch(function(error) {
				// unsubscribeTx failure
				errFunc('unsubscribeTx failure.' + error);
			});

			//return error message
			errFunc(result);
		} else {
			// submit successfully
			if (isFunction === false && callback !== undefined && callback.expect === 'send_success') {
				sucFunc({
					status: 'send_success',
					tx_hash: signedVal.id
				});
			}
		}
	}).catch(function(error) {
		errFunc(error);
	});
}

async function getContractAddr(chainSQL, txHash){
	let txDetail = await chainSQL.api.getTransaction(txHash);
	let affectedNodes = txDetail.specification.meta.AffectedNodes;
	let contractAddr = "";
	for(let node of affectedNodes){
		if(node.hasOwnProperty("CreatedNode")){
			let createdNodeObj = node.CreatedNode;
			contractAddr = createdNodeObj.NewFields.Account;
			break;
		}
		else continue;
	}
	return contractAddr;
}

/**
 * Adds event listeners and creates a subscription.
 *
 * @method _on
 * @param {String} event
 * @param {Object} options
 * @param {Function} callback
 * @return {Object} the event subscription
 */
Contract.prototype._on = function(){
	var subOptions = this._generateEventOptions.apply(this, arguments);


	// prevent the event "newListener" and "removeListener" from being overwritten
	this._checkListener('newListener', subOptions.event.name, subOptions.callback);
	this._checkListener('removeListener', subOptions.event.name, subOptions.callback);

	// TODO check if listener already exists? and reuse subscription if options are the same.

	let chainSQL = this.chainsql;
	//this._decodeEventABI.bind(subOptions.event),
	chainSQL.event.subscribeCtrAddr(this, subOptions.event.signature, subOptions.callback);
};

/**
 * Gets the event signature and outputformatters
 *
 * @method _generateEventOptions
 * @param {Object} event
 * @param {Object} options
 * @param {Function} callback
 * @return {Object} the event options object
 */
Contract.prototype._generateEventOptions = function() {
	var args = Array.prototype.slice.call(arguments);

	// get the callback
	var callback = this._getCallback(args);

	// get the options
	var options = (_.isObject(args[args.length - 1])) ? args.pop() : {};

	var event = (_.isString(args[0])) ? args[0] : 'allevents';
	event = (event.toLowerCase() === 'allevents') ? {
		name: 'ALLEVENTS',
		jsonInterface: this.options.jsonInterface
	} : this.options.jsonInterface.find(function (json) {
		return (json.type === 'event' && (json.name === event || json.signature === '0x'+ event.replace('0x','')));
	});

	if (!event) {
		throw new Error('Event "' + event.name + '" doesn\'t exist in this contract.');
	}

	// if (!utils.isAddress(this.options.address)) {
	// 	throw new Error('This contract object doesn\'t have address set yet, please set an address first.');
	// }
	if (!this.options.address) {
		throw new Error('This contract object doesn\'t have address set yet, please set an address first.');
	}

	return {
		params: this._encodeEventABI(event, options),
		event: event,
		callback: callback
	};
};

/**
 * Checks that no listener with name "newListener" or "removeListener" is added.
 *
 * @method _checkListener
 * @param {String} type
 * @param {String} event
 * @return {Object} the contract instance
 */
Contract.prototype._checkListener = function(type, event){
	if(event === type) {
		throw new Error('The event "'+ type +'" is a reserved event name, you can\'t use it.');
	}
};

/**
 * returns the an object with call, send, estimate functions
 *
 * @method _createTxObject
 * @returns {Object} an object with functions to call the methods
 */
Contract.prototype._createTxObject =  function _createTxObject(){
	var args = Array.prototype.slice.call(arguments);
	var txObject = {};

	if(this.method.type === 'function') {
		txObject.call = this.parent._executeMethod.bind(txObject, 'call');
		txObject.call.request = this.parent._executeMethod.bind(txObject, 'call', true); // to make batch requests
	}

	txObject.send = this.parent._executeMethod.bind(txObject, 'send');
	txObject.send.request = this.parent._executeMethod.bind(txObject, 'send', true); // to make batch requests
	txObject.encodeABI = this.parent._encodeMethodABI.bind(txObject);
	txObject.estimateGas = this.parent._executeMethod.bind(txObject, 'estimate');

	if (args && this.method.inputs && args.length !== this.method.inputs.length) {
		if (this.nextMethod) {
			return this.nextMethod.apply(null, args);
		}
		throw errors.InvalidNumberOfParams(args.length, this.method.inputs.length, this.method.name);
	}

	txObject.arguments = args || [];
	txObject._method = this.method;
	txObject._parent = this.parent;
	txObject._ethAccounts = this.parent.constructor._ethAccounts || this._ethAccounts;

	if(this.deployData) {
		txObject._deployData = this.deployData;
	}

	return txObject;
};

/**
 * Executes a call, transact or estimateGas on a contract function
 *
 * @method _executeMethod
 * @param {String} type the type this execute function should execute
 * @param {Boolean} makeRequest if true, it simply returns the request parameters, rather than executing it
 */
Contract.prototype._executeMethod = function _executeMethod(){
	var _this = this,
		args = this._parent._processExecuteArguments.call(this, Array.prototype.slice.call(arguments)/*, defer*/);
		//defer = promiEvent((args.type !== 'send')),
		//ethAccounts = _this.constructor._ethAccounts || _this._ethAccounts;

	// simple return request for batch requests
	if(args.generateRequest) {

		var payload = {
			params: [formatters.inputCallFormatter.call(this._parent, args.options)],
			callback: args.callback
		};

		if(args.type === 'call') {
			payload.params.push(formatters.inputDefaultBlockNumberFormatter.call(this._parent, args.defaultBlock));
			payload.method = 'eth_call';
			payload.format = this._parent._decodeMethodReturn.bind(null, this._method.outputs);
		} else {
			payload.method = 'eth_sendTransaction';
		}

		return payload;
	} else {
		let errorMsg = "";
		switch (args.type) {
		// case 'estimate':
		// 	var estimateGas = (new Method({
		// 		name: 'estimateGas',
		// 		call: 'eth_estimateGas',
		// 		params: 1,
		// 		inputFormatter: [formatters.inputCallFormatter],
		// 		outputFormatter: utils.hexToNumber,
		// 		requestManager: _this._parent._requestManager,
		// 		accounts: ethAccounts, // is eth.accounts (necessary for wallet signing)
		// 		defaultAccount: _this._parent.defaultAccount,
		// 		defaultBlock: _this._parent.defaultBlock
		// 	})).createFunction();

		// 	return estimateGas(args.options, args.callback);

		case 'call':
			if ((typeof args.callback) != 'function') {
				let this_ = this;
				return new Promise(function (resolve, reject) {
					handleContractCall(this_, args.options, args.callback, resolve, reject);
				});
			} else {
				handleContractCall(this, args.options, args.callback, null, null);
			}
			break;
			// TODO check errors: missing "from" should give error on deploy and send, call ?
		case 'send':{
			let contractData = args.options.data.length >= 2 ? args.options.data.slice(2) : args.options.data;
			let sendTxPayment = {
				TransactionType : "Contract",
				ContractOpType : 2,
				Account : this._parent.connect.address,
				ContractAddress : args.options.to,
				Gas : args.options.Gas,
				ContractData : contractData.toUpperCase()
			};
			if ((typeof args.callback) != 'function') {
				let contractObj = this._parent;
				return new Promise(function (resolve, reject) {
					handleContractSendTx(contractObj, sendTxPayment, args.callback, resolve, reject);
				});
			} else {
				handleContractSendTx(this._parent, sendTxPayment, args.callback, null, null);
			}
			break;
		}
		default:
			errorMsg = "Error, not defined call type!";
			if ((typeof args.callback) != 'function') {
				return new Promise(function (resolve, reject) {
					reject(errorMsg);
				});
			} else {
				args.callback(errorMsg, null);
			}
		}
	}
};

function handleContractCall(curFunObj, callObj, callBack, resolve, reject) {
	var isFunction = false;
	if ((typeof callBack) === 'function') 
		isFunction = true;
	
	var callBackFun = function(error, data) {
		if (isFunction) {
			callBack(error, data);
		} else {
			if (error) {
				reject(error);
			} else {
				resolve(data);
			}
		}
	};
	const contractObj = curFunObj._parent;
	var connect = contractObj.connect;
	const contractData = callObj.data.length >= 2 ? callObj.data.slice(2) : callObj.data;
	connect.api.connection.request({
		command: 'contract_call',
		account : connect.address,
		contract_address : callObj.to,
		contract_data : contractData.toUpperCase()
	}).then(function(data) {
		// if (data.status != 'success'){
		// 	callBackFun(new Error(data), null);
		// }
		//begin to decode return value,then get result and set to callBack
		var resultStr = data.contract_call_result;
		var localcallResult = contractObj._decodeMethodReturn(curFunObj._method.outputs, resultStr);
		callBackFun(null, localcallResult);
	}).catch(function(err) {
		callBackFun(err, null);
	});
}

function handleContractSendTx(contractObj, sendTxObj, callBack, resolve, reject){
	let chainSQL = contractObj.chainsql;
	var errFunc = function(error) {
		if ((typeof callBack) == 'function') {
			callBack(error, null);
		} else {
			reject(error);
		}
	};
	prepareSendTxPayment(chainSQL, sendTxObj).then(data => {
		let signedRet = chainSQL.api.sign(data.txJSON, chainSQL.connect.secret);
		submitTxCallTx(chainSQL, signedRet, callBack, resolve, reject);
	}).catch(err => {
		errFunc(err);
	});
}
function prepareSendTxPayment(chainSQL, sendTxPayment){
	var instructions = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];
	const txJSON = createSendTxPayment(sendTxPayment);
	return chainsqlUtils.prepareTransaction(txJSON, chainSQL.api, instructions);
}
function createSendTxPayment(sendTxPayment){
	var newTxCallPayment = _.cloneDeep(sendTxPayment);

	var txJSON = {
		TransactionType : newTxCallPayment.TransactionType,
		ContractOpType  : newTxCallPayment.ContractOpType,
		Account : newTxCallPayment.Account,
		ContractAddress : newTxCallPayment.ContractAddress,
		ContractData : newTxCallPayment.ContractData,
		Gas : newTxCallPayment.Gas
	};
	return txJSON;
}
function submitTxCallTx(chainSQL, signedVal, callBack, resolve, reject){
	var isFunction = false;
	if ((typeof callBack) == 'function')
		isFunction = true;
	
	var errFunc = function(error) {
		if (isFunction) {
			callBack(error, null);
		} else {
			reject(error);
		}
	};
	var sucFunc = function(data){
		if(isFunction){
			callBack(null,data);
		}else{
			resolve(data);
		}
	};
	//will handle solidity event later
	
	// submit transaction
	chainSQL.api.submit(signedVal.signedTransaction).then(function(result) {
		//console.log('submit ', JSON.stringify(result));
		if (result.resultCode !== 'tesSUCCESS') {
			//return error message
			errFunc(result);
		} else {
			// submit successfully
			sucFunc({
				status: 'send_success',
				tx_hash: signedVal.id
			});
		}
	}).catch(function(error) {
		errFunc(error);
	});
}

/**
 * Get the callback and modiufy the array if necessary
 *
 * @method _getCallback
 * @param {Array} args
 * @return {Function} the callback
 */
Contract.prototype._getCallback = function getCallback(args) {
	if (args && _.isFunction(args[args.length - 1])) {
		return args.pop(); // modify the args array!
	}
};

/**
 * Generates the options for the execute call
 *
 * @method _processExecuteArguments
 * @param {Array} args
 * @param {Promise} defer
 */
Contract.prototype._processExecuteArguments = function _processExecuteArguments(args/*, defer*/) {
	var processedArgs = {};

	processedArgs.type = args.shift();

	// get the callback
	processedArgs.callback = this._parent._getCallback(args);

	// get block number to use for call
	//if(processedArgs.type === 'call' && args[args.length - 1] !== true && (_.isString(args[args.length - 1]) || isFinite(args[args.length - 1])))
	//    processedArgs.defaultBlock = args.pop();

	// get the options
	processedArgs.options = (_.isObject(args[args.length - 1])) ? args.pop() : {};

	// get the generateRequest argument for batch requests
	processedArgs.generateRequest = (args[args.length - 1] === true)? args.pop() : false;

	processedArgs.options = this._parent._getOrSetDefaultOptions(processedArgs.options);
	processedArgs.options.data = this.encodeABI();

	// add contract address
	//if(!this._deployData && !utils.isAddress(this._parent.options.address))
	if(!this._deployData && !this._parent.options.address)
		throw new Error('This contract object doesn\'t have address set yet, please set an address first.');

	if(!this._deployData)
		processedArgs.options.to = this._parent.options.address;

	// return error, if no "data" is specified
	//if(!processedArgs.options.data)
	//    return utils._fireError(new Error('Couldn\'t find a matching contract method, or the number of parameters is wrong.'), defer.eventEmitter, defer.reject, processedArgs.callback);

	return processedArgs;
};

module.exports = Contract;