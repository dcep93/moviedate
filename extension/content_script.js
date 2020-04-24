var email;
var peers;

var element;

var syncListener;
var expected = null;

const CHANGE_DIFF_CUTOFF = 0.05;
const FOLLOW_UP_DIFF_CUTOFF = 0.001;
const FOLLOW_UP_TICKS = 5;
const FOLLOW_UP_TICK_DURATION = 1000;

// todo
function followUp(state, ticks) {
	if (state.paused !== false) return;
	var stateTime = determineTime(state);
	var diff = stateTime - element.currentTime;
	if (Math.abs(diff) < FOLLOW_UP_DIFF_CUTOFF) {
		element.playbackRate = state.speed;
		return;
	}
	var relative = diff / FOLLOW_UP_TICK_DURATION;
	element.playbackRate += relative;
	if (ticks) {
		setTimeout(() => followUp(state, ticks - 1), FOLLOW_UP_TICK_DURATION);
	} else {
		element.playbackRate = state.speed;
	}
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
	console.log("receive", message.type, message);
	var respond = (response) =>
		console.log("send", response) || sendResponse(response);
	switch (message.type) {
		case "init":
			return init(respond, message);
		case "query":
			query(respond, message);
			break;
		case "set_state":
			setState(respond, message);
			break;
		case "sync":
			sync(respond, message);
			break;
		default:
			return respond(`invalid type: ${message.type}`);
	}
});

function init(sendResponse, message) {
	element = document.getElementsByTagName("video")[0];
	if (element === undefined || isNaN(element.duration))
		return sendResponse("no video found");
	email = message.email;
	if (db === undefined) beginReporting();
	return handleInject(sendResponse);
}

function query(sendResponse) {
	sendResponse({ email, peers });
}

function setState(sendResponse, message) {
	setStateHelper(message.state);
	expected = null;
	sendResponse(true);
}

function setStateHelper(state) {
	console.log("setting state", state);
	expected = state;
	return setStatePromise(state).then(followUp);
}

function setStatePromise(state) {
	if (inject !== null) {
		injectedElement.value = JSON.stringify(state);
		return new Promise((resolve, reject) => {
			var interval = setInterval(() => {
				if (injectedElement.value !== "") return;
				clearInterval(interval);
				resolve(state);
			});
		});
	} else {
		if (state.speed !== undefined) element.playbackRate = state.speed;
		if (state.time !== undefined)
			element.currentTime = determineTime(state);
		if (state.paused !== undefined) {
			var f = state.paused ? "pause" : "play";
			return element[f]().then(() => state);
		} else {
			return Promise.resolve(state);
		}
	}
}

function sync(sendResponse, message) {
	if (syncListener !== undefined) syncListener.off();
	var key = message.key;
	var peer = peers[key];
	var path = listenerRef.path.pieces_.concat(key).join("/");
	setStateHelper(peer).then(() => {
		listenToPeer(path);
	});
	sendResponse(true);
}

function listenToPeer(path) {
	if (syncListener !== undefined) syncListener.off();
	syncListener = db.ref(path);
	syncListener.on("value", function (snapshot) {
		var peer = snapshot.val();
		var state = getState();
		if (
			!expected ||
			isDifferent(expected, state, "me") ||
			expected.duration !== peer.duration
		)
			return syncListener.off();
		if (isDifferent(expected, peer, "peer")) {
			setStateHelper(peer);
		}
	});
}

function isDifferent(a, b, tag) {
	var aTime = determineTime(a);
	var bTime = determineTime(b);
	var diff = Math.abs(aTime - bTime);
	if (diff > CHANGE_DIFF_CUTOFF) {
		logDifferent(tag, "*time", aTime, bTime);
		return true;
	}
	for (var key in a) {
		if (key == "date" || key == "time" || key == "email") continue;
		if (a[key] != b[key]) {
			logDifferent(tag, key, a[key], b[key]);
			return true;
		}
	}
	return false;
}

function logDifferent(tag, key, meKey, expectedKey) {
	console.log(`different ${tag} ${key} ${meKey} ${expectedKey}`);
	expected = null;
}
