"use strict";

// Dropbox API parameters and responses use snake_case
/* eslint-disable camelcase */

describe("Zotero.Sync.Storage.Mode.Dropbox", function () {
	// Zotero.reinit() in other tests replaces Zotero.Sync.Storage.Dropbox, so get it in beforeEach()
	var dropbox;
	var appKey = "test-app-key";
	var originalSettings;
	var httpd, port, baseURL;
	var fake, controller;
	var stubs = [];
	
	
	//
	// Fake Dropbox API
	//
	function createFakeDropbox() {
		return {
			// Lowercased path -> { path, content, serverModified }
			files: new Map(),
			folders: new Set(['']),
			sessions: new Map(),
			accessTokens: new Set(),
			refreshToken: 'test-refresh-token',
			authCode: 'test-auth-code',
			codeChallenge: null,
			redirectURI: null,
			tokenCount: 0,
			// Endpoint -> array of { status, body } to return before handling normally
			failures: {},
			requests: [],
			listPageSize: 2
		};
	}
	
	
	function readBody(request) {
		var bis = Cc["@mozilla.org/binaryinputstream;1"]
			.createInstance(Ci.nsIBinaryInputStream);
		bis.setInputStream(request.bodyInputStream);
		var bytes = bis.readByteArray(bis.available());
		bis.close();
		return new Uint8Array(bytes);
	}
	
	
	function bytesToBinaryString(bytes) {
		var str = "";
		for (let i = 0; i < bytes.length; i += 8192) {
			str += String.fromCharCode(...bytes.subarray(i, i + 8192));
		}
		return str;
	}
	
	
	function concatBytes(a, b) {
		var bytes = new Uint8Array(a.length + b.length);
		bytes.set(a, 0);
		bytes.set(b, a.length);
		return bytes;
	}
	
	
	function sendJSON(response, status, obj) {
		response.setStatusLine(null, status, null);
		response.setHeader('Content-Type', 'application/json; charset=utf-8', false);
		// httpd writes strings as bytes, so encode as UTF-8 first
		response.write(bytesToBinaryString(new TextEncoder().encode(JSON.stringify(obj))));
	}
	
	
	function sendError(response, summary, error) {
		sendJSON(response, 409, {
			error_summary: summary,
			error: error || { ".tag": summary.split('/')[0] }
		});
	}
	
	
	function fileMetadata(file) {
		return {
			".tag": "file",
			name: file.path.split('/').pop(),
			path_display: file.path,
			path_lower: file.path.toLowerCase(),
			size: file.content.length,
			server_modified: file.serverModified.toISOString().replace(/\.\d+Z$/, 'Z')
		};
	}
	
	
	function addFile(path, content, serverModified = new Date()) {
		if (typeof content == 'string') {
			content = new TextEncoder().encode(content);
		}
		fake.files.set(path.toLowerCase(), { path, content, serverModified });
	}
	
	
	function getFileText(path) {
		var file = fake.files.get(path.toLowerCase());
		return file ? new TextDecoder().decode(file.content) : null;
	}
	
	
	function parentPath(path) {
		return path.toLowerCase().replace(/\/[^/]*$/, '');
	}
	
	
	function registerFakeDropbox() {
		var rpc = function (endpoint, fn) {
			register(endpoint, function (request, response) {
				var body = new TextDecoder().decode(readBody(request));
				fn(body ? JSON.parse(body) : null, request, response);
			});
		};
		
		var content = function (endpoint, fn) {
			register(endpoint, function (request, response) {
				var header = request.getHeader('Dropbox-API-Arg');
				// The header has to be ASCII
				assert.match(header, /^[\x20-\x7e]*$/);
				var body = request.method == 'POST' ? readBody(request) : new Uint8Array();
				fn(JSON.parse(header), body, request, response);
			});
		};
		
		var register = function (endpoint, fn) {
			httpd.registerPathHandler('/2/' + endpoint, {
				handle: function (request, response) {
					fake.requests.push(endpoint);
					var failures = fake.failures[endpoint];
					if (failures && failures.length) {
						let failure = failures.shift();
						sendJSON(response, failure.status, failure.body);
						return;
					}
					var auth = request.hasHeader('Authorization') && request.getHeader('Authorization');
					var token = auth && auth.replace(/^Bearer /, '');
					if (!fake.accessTokens.has(token)) {
						sendJSON(response, 401, {
							error_summary: "expired_access_token/",
							error: { ".tag": "expired_access_token" }
						});
						return;
					}
					fn(request, response);
				}
			});
		};
		
		httpd.registerPathHandler('/oauth2/token', {
			handle: function (request, response) {
				// The PKCE check below is asynchronous
				response.processAsync();
				handleToken(request, response).finally(() => response.finish());
			}
		});
		
		var handleToken = async function (request, response) {
			fake.requests.push('oauth2/token');
			var params = new URLSearchParams(new TextDecoder().decode(readBody(request)));
			if (params.get('client_id') != appKey) {
				sendJSON(response, 400, { error: "invalid_client" });
				return;
			}
			if (params.get('grant_type') == 'refresh_token') {
				if (params.get('refresh_token') != fake.refreshToken) {
					sendJSON(response, 400, {
						error: "invalid_grant",
						error_description: "refresh token is invalid or revoked"
					});
					return;
				}
			}
			else if (params.get('grant_type') == 'authorization_code') {
				if (params.get('code') != fake.authCode
						|| (params.get('redirect_uri') || null) != fake.redirectURI) {
					sendJSON(response, 400, { error: "invalid_grant" });
					return;
				}
				// Check the PKCE verifier against the challenge from the authorization URL
				let digest = await crypto.subtle.digest(
					'SHA-256', new TextEncoder().encode(params.get('code_verifier'))
				);
				let challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
					.replace(/\+/g, '-')
					.replace(/\//g, '_')
					.replace(/=+$/, '');
				if (challenge != fake.codeChallenge) {
					sendJSON(response, 400, { error: "invalid_grant" });
					return;
				}
			}
			else {
				sendJSON(response, 400, { error: "unsupported_grant_type" });
				return;
			}
			var token = 'access-token-' + (++fake.tokenCount);
			fake.accessTokens.add(token);
			var json = {
				access_token: token,
				token_type: "bearer",
				expires_in: 14400
			};
			if (params.get('grant_type') == 'authorization_code') {
				json.refresh_token = fake.refreshToken;
				json.account_id = "dbid:test";
			}
			sendJSON(response, 200, json);
		};
		
		rpc('users/get_current_account', function (args, request, response) {
			sendJSON(response, 200, {
				account_id: "dbid:test",
				name: { display_name: "테스트 사용자" },
				email: "user@example.com"
			});
		});
		
		rpc('auth/token/revoke', function (args, request, response) {
			fake.accessTokens.clear();
			sendJSON(response, 200, null);
		});
		
		rpc('files/get_metadata', function (args, request, response) {
			var path = args.path.toLowerCase();
			if (fake.folders.has(path)) {
				sendJSON(response, 200, {
					".tag": "folder",
					name: args.path.split('/').pop(),
					path_display: args.path
				});
				return;
			}
			var file = fake.files.get(path);
			if (file) {
				sendJSON(response, 200, fileMetadata(file));
				return;
			}
			sendError(response, "path/not_found/..", { ".tag": "path", path: { ".tag": "not_found" } });
		});
		
		rpc('files/create_folder_v2', function (args, request, response) {
			var path = args.path.toLowerCase();
			if (fake.folders.has(path)) {
				sendError(response, "path/conflict/folder/..");
				return;
			}
			fake.folders.add(path);
			sendJSON(response, 200, { metadata: { ".tag": "folder", path_display: args.path } });
		});
		
		rpc('files/delete_v2', function (args, request, response) {
			var path = args.path.toLowerCase();
			var file = fake.files.get(path);
			if (!file) {
				sendError(response, "path_lookup/not_found/..");
				return;
			}
			fake.files.delete(path);
			sendJSON(response, 200, { metadata: fileMetadata(file) });
		});
		
		var listFolder = function (path, start, response) {
			var entries = [...fake.files.values()]
				.filter(file => parentPath(file.path) == path)
				.map(fileMetadata);
			var page = entries.slice(start, start + fake.listPageSize);
			var next = start + page.length;
			sendJSON(response, 200, {
				entries: page,
				cursor: JSON.stringify({ path, start: next }),
				has_more: next < entries.length
			});
		};
		
		rpc('files/list_folder', function (args, request, response) {
			var path = args.path.toLowerCase();
			if (!fake.folders.has(path)) {
				sendError(response, "path/not_found/..");
				return;
			}
			listFolder(path, 0, response);
		});
		
		rpc('files/list_folder/continue', function (args, request, response) {
			var cursor = JSON.parse(args.cursor);
			listFolder(cursor.path, cursor.start, response);
		});
		
		var commitFile = function (commit, bytes, response) {
			if (!fake.folders.has(parentPath(commit.path))) {
				// Dropbox creates missing parent folders automatically
				fake.folders.add(parentPath(commit.path));
			}
			assert.equal(commit.mode, 'overwrite');
			addFile(commit.path, bytes);
			sendJSON(response, 200, fileMetadata(fake.files.get(commit.path.toLowerCase())));
		};
		
		content('files/upload', function (args, body, request, response) {
			assert.equal(request.getHeader('Content-Type'), 'application/octet-stream');
			commitFile(args, body, response);
		});
		
		content('files/upload_session/start', function (args, body, request, response) {
			var sessionID = 'session-' + (fake.sessions.size + 1);
			fake.sessions.set(sessionID, body);
			sendJSON(response, 200, { session_id: sessionID });
		});
		
		content('files/upload_session/append_v2', function (args, body, request, response) {
			var data = fake.sessions.get(args.cursor.session_id);
			if (args.cursor.offset != data.length) {
				sendError(response, "incorrect_offset/..", {
					".tag": "incorrect_offset",
					correct_offset: data.length
				});
				return;
			}
			fake.sessions.set(args.cursor.session_id, concatBytes(data, body));
			sendJSON(response, 200, null);
		});
		
		content('files/upload_session/finish', function (args, body, request, response) {
			var data = fake.sessions.get(args.cursor.session_id);
			assert.equal(args.cursor.offset, data.length);
			fake.sessions.delete(args.cursor.session_id);
			commitFile(args.commit, concatBytes(data, body), response);
		});
		
		content('files/download', function (args, body, request, response) {
			var file = fake.files.get(args.path.toLowerCase());
			if (!file) {
				sendError(response, "path/not_found/..", { ".tag": "path", path: { ".tag": "not_found" } });
				return;
			}
			response.setStatusLine(null, 200, "OK");
			response.setHeader('Content-Type', 'application/octet-stream', false);
			response.setHeader(
				'Dropbox-API-Result', dropbox.headerSafeJSON(fileMetadata(file)), false
			);
			response.write(bytesToBinaryString(file.content));
		});
	}
	
	
	async function createZip(fileName, text) {
		var tmpPath = Zotero.getTempDirectory().path;
		var tmpID = "dropbox_download_" + Zotero.Utilities.randomString();
		var zipDirPath = PathUtils.join(tmpPath, tmpID);
		var zipPath = PathUtils.join(tmpPath, tmpID + ".zip");
		await IOUtils.makeDirectory(zipDirPath);
		await Zotero.File.putContentsAsync(PathUtils.join(zipDirPath, fileName), text);
		await Zotero.File.zipDirectory(zipDirPath, zipPath);
		await IOUtils.remove(zipDirPath, { recursive: true });
		var bytes = await IOUtils.read(zipPath);
		await IOUtils.remove(zipPath);
		return bytes;
	}
	
	
	async function getZipEntries(bytes) {
		var zipPath = PathUtils.join(
			Zotero.getTempDirectory().path, Zotero.Utilities.randomString() + '.zip'
		);
		await IOUtils.write(zipPath, bytes);
		var zr = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
		zr.open(Zotero.File.pathToFile(zipPath));
		zr.test(null);
		var entries = zr.findEntries('*');
		var entryNames = [];
		while (entries.hasMore()) {
			entryNames.push(entries.getNext());
		}
		zr.close();
		await IOUtils.remove(zipPath);
		return entryNames;
	}
	
	
	function propText(mtime, md5) {
		return '<properties version="1">'
			+ `<mtime>${mtime}</mtime>`
			+ `<hash>${md5}</hash>`
			+ '</properties>';
	}
	
	
	async function setup() {
		var engine = new Zotero.Sync.Storage.Engine({
			libraryID: Zotero.Libraries.userLibraryID,
			controller,
			stopOnError: true
		});
		if (!controller.verified) {
			await controller.checkServer();
		}
		fake.requests = [];
		return engine;
	}
	
	
	//
	// Setup
	//
	
	beforeEach(async function () {
		await resetData();
		
		dropbox = Zotero.Sync.Storage.Dropbox;
		originalSettings = {
			API_URL: dropbox.API_URL,
			CONTENT_URL: dropbox.CONTENT_URL,
			TOKEN_URL: dropbox.TOKEN_URL,
			ERROR_DELAY_INTERVALS: dropbox.ERROR_DELAY_INTERVALS,
			ERROR_DELAY_MAX: dropbox.ERROR_DELAY_MAX,
			WRITE_CONFLICT_DELAYS: dropbox.WRITE_CONFLICT_DELAYS,
			SINGLE_UPLOAD_MAX_SIZE: dropbox.SINGLE_UPLOAD_MAX_SIZE,
			UPLOAD_CHUNK_SIZE: dropbox.UPLOAD_CHUNK_SIZE
		};
		
		({ httpd, port } = await startHTTPServer());
		baseURL = `http://localhost:${port}/`;
		Object.assign(dropbox, originalSettings, {
			API_URL: baseURL + '2/',
			CONTENT_URL: baseURL + '2/',
			TOKEN_URL: baseURL + 'oauth2/token',
			ERROR_DELAY_INTERVALS: [1],
			ERROR_DELAY_MAX: 5,
			WRITE_CONFLICT_DELAYS: [1, 1]
		});
		
		// Don't depend on the OS key store
		stubs.push(sinon.stub(Zotero.OSKeyStore, 'encrypt').callsFake(async v => 'oskv1:' + btoa(v)));
		stubs.push(sinon.stub(Zotero.OSKeyStore, 'decrypt').callsFake(async v => atob(v.slice(6))));
		
		await Zotero.Users.setCurrentUserID(1);
		await Zotero.Users.setCurrentUsername("testuser");
		
		Zotero.Prefs.set('sync.storage.dropbox.appKey', appKey);
		Zotero.Prefs.set('sync.storage.dropbox.folder', '/zotero');
		Zotero.Prefs.set('sync.storage.dropbox.verified', false);
		Zotero.Sync.Storage.Local.setModeForLibrary(Zotero.Libraries.userLibraryID, 'dropbox');
		dropbox.clearAccessToken();
		
		fake = createFakeDropbox();
		registerFakeDropbox();
		await dropbox.setRefreshToken(fake.refreshToken);
		
		controller = new Zotero.Sync.Storage.Mode.Dropbox;
		controller.ERROR_DELAY_INTERVALS = [1];
		controller.ERROR_DELAY_MAX = 5;
		
		// Set download-on-sync by default
		Zotero.Sync.Storage.Local.downloadOnSync(Zotero.Libraries.userLibraryID, true);
	});
	
	afterEach(async function () {
		dropbox.cancelAuthorization();
		await dropbox._writeRefreshToken(null, null);
		dropbox.clearAccessToken();
		for (let stub of stubs) {
			stub.restore();
		}
		stubs = [];
		Object.assign(dropbox, originalSettings);
		for (let pref of ['appKey', 'folder', 'verified', 'accountName', 'accountEmail']) {
			Zotero.Prefs.clear('sync.storage.dropbox.' + pref);
		}
		Zotero.Prefs.clear('lastDropboxOrphanPurge');
		Zotero.Prefs.clear('sync.storage.protocol');
		await new Promise(resolve => httpd.stop(resolve));
	});
	
	
	//
	// Tests
	//
	describe("Zotero.Sync.Storage.Dropbox", function () {
		it("should escape non-ASCII characters in Dropbox-API-Arg", function () {
			var json = dropbox.headerSafeJSON({ path: "/조테로/파일\u007f.zip" });
			assert.match(json, /^[\x20-\x7e]*$/);
			assert.equal(JSON.parse(json).path, "/조테로/파일\u007f.zip");
		});
		
		it("should normalize the folder", function () {
			Zotero.Prefs.set('sync.storage.dropbox.folder', ' //Apps//Zotero/ ');
			assert.equal(dropbox.folder, '/Apps/Zotero');
			Zotero.Prefs.set('sync.storage.dropbox.folder', '/');
			assert.equal(dropbox.folder, '/zotero');
		});
		
		it("should store the refresh token per app key", async function () {
			assert.equal(await dropbox.getRefreshToken(), fake.refreshToken);
			Zotero.Prefs.set('sync.storage.dropbox.appKey', 'other-app-key');
			assert.isNull(await dropbox.getRefreshToken());
			assert.isFalse(await dropbox.isConnected());
		});
		
		it("should refresh an expired access token and retry", async function () {
			dropbox._accessToken = 'stale-token';
			dropbox._accessTokenExpiration = Date.now() + 3600 * 1000;
			var account = await dropbox.getCurrentAccount();
			assert.equal(account.email, "user@example.com");
			assert.sameOrderedMembers(
				fake.requests,
				['users/get_current_account', 'oauth2/token', 'users/get_current_account']
			);
		});
		
		it("should share a single refresh between concurrent requests", async function () {
			await Promise.all([
				dropbox.getCurrentAccount(),
				dropbox.getCurrentAccount(),
				dropbox.getCurrentAccount()
			]);
			assert.equal(fake.requests.filter(r => r == 'oauth2/token').length, 1);
		});
		
		it("should report a revoked refresh token", async function () {
			fake.refreshToken = 'new-refresh-token';
			var e = await getPromiseError(dropbox.getCurrentAccount());
			assert.equal(e.dropboxError, 'AUTH_REVOKED');
			assert.equal(e.message, Zotero.ftl.formatValueSync('sync-storage-dropbox-error-auth-revoked'));
		});
		
		it("should report a missing permission", async function () {
			fake.failures['files/list_folder'] = [{
				status: 401,
				body: {
					error_summary: "missing_scope/..",
					error: { ".tag": "missing_scope", required_scope: "files.metadata.read" }
				}
			}];
			var e = await getPromiseError(dropbox.listFolder('/zotero'));
			assert.equal(e.dropboxError, 'MISSING_SCOPE');
			assert.include(e.message, "files.metadata.read");
		});
		
		it("should require an app key", async function () {
			Zotero.Prefs.set('sync.storage.dropbox.appKey', '');
			var e = await getPromiseError(dropbox.getAccessToken());
			assert.equal(e.dropboxError, 'NO_APP_KEY');
		});
		
		it("should retry a write that conflicts with other writes", async function () {
			fake.failures['files/upload'] = [{
				status: 409,
				body: {
					error_summary: "path/too_many_write_operations/..",
					error: { ".tag": "path", reason: { ".tag": "too_many_write_operations" } }
				}
			}];
			await dropbox.upload('/zotero/a.prop', new TextEncoder().encode("a"));
			assert.equal(getFileText('/zotero/a.prop'), "a");
		});
		
		it("should upload a large file in a session", async function () {
			dropbox.SINGLE_UPLOAD_MAX_SIZE = 10;
			dropbox.UPLOAD_CHUNK_SIZE = 4;
			var text = "0123456789abcdefghij-";
			var path = PathUtils.join(Zotero.getTempDirectory().path, 'dropbox-large.txt');
			await Zotero.File.putContentsAsync(path, text);
			var progress = [];
			await dropbox.uploadFile('/zotero/large.zip', path, {
				onProgress: (loaded, total) => progress.push([loaded, total])
			});
			await IOUtils.remove(path);
			
			assert.equal(getFileText('/zotero/large.zip'), text);
			assert.equal(fake.requests.filter(r => r == 'files/upload_session/append_v2').length, 4);
			assert.equal(fake.requests.filter(r => r == 'files/upload').length, 0);
			assert.deepEqual(progress[progress.length - 1], [text.length, text.length]);
		});
		
		it("should continue an upload session from the offset Dropbox has", async function () {
			dropbox.SINGLE_UPLOAD_MAX_SIZE = 10;
			dropbox.UPLOAD_CHUNK_SIZE = 4;
			var text = "0123456789abcdef";
			var path = PathUtils.join(Zotero.getTempDirectory().path, 'dropbox-retry.txt');
			await Zotero.File.putContentsAsync(path, text);
			// Pretend the first append reached Dropbox but the response was lost
			var originalContentUpload = dropbox.contentUpload;
			var lost = false;
			stubs.push(sinon.stub(dropbox, 'contentUpload').callsFake(async function (endpoint, args, body, options) {
				var result = await originalContentUpload.call(dropbox, endpoint, args, body, options);
				if (endpoint == 'files/upload_session/append_v2' && !lost) {
					lost = true;
					throw new dropbox.APIError(409, "incorrect_offset/..", {
						".tag": "incorrect_offset",
						correct_offset: args.cursor.offset + body.size
					});
				}
				return result;
			}));
			await dropbox.uploadFile('/zotero/retry.zip', path);
			await IOUtils.remove(path);
			assert.equal(getFileText('/zotero/retry.zip'), text);
		});
		
		it("should handle Korean paths", async function () {
			Zotero.Prefs.set('sync.storage.dropbox.folder', '/조테로 파일');
			await dropbox.upload(dropbox.folder + '/한글.prop', new TextEncoder().encode("내용"));
			assert.equal(getFileText('/조테로 파일/한글.prop'), "내용");
			assert.equal(await dropbox.downloadText('/조테로 파일/한글.prop'), "내용");
		});
	});
	
	
	describe("Authorization", function () {
		beforeEach(async function () {
			await dropbox._writeRefreshToken(null, null);
		});
		
		it("should connect an account with PKCE through the local redirect", async function () {
			var { url, verifier, redirectURI, codePromise } = await dropbox.startAuthorization();
			url = new URL(url);
			assert.equal(url.searchParams.get('client_id'), appKey);
			assert.equal(url.searchParams.get('response_type'), 'code');
			assert.equal(url.searchParams.get('token_access_type'), 'offline');
			assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
			assert.equal(url.searchParams.get('redirect_uri'), dropbox.redirectURI);
			assert.notInclude(url.href, verifier);
			fake.codeChallenge = url.searchParams.get('code_challenge');
			fake.redirectURI = redirectURI;
			
			// Simulate the browser being redirected to the local server
			var redirect = `http://127.0.0.1:${Zotero.Prefs.get('httpServer.port')}`
				+ `${dropbox.REDIRECT_PATH}?state=${url.searchParams.get('state')}&code=${fake.authCode}`;
			var xmlhttp = await Zotero.HTTP.request("GET", redirect, { successCodes: [200] });
			assert.include(
				xmlhttp.responseText,
				Zotero.ftl.formatValueSync('sync-storage-dropbox-redirect-success-title')
			);
			
			var code = await codePromise;
			var account = await dropbox.completeAuthorization(code, verifier, redirectURI);
			assert.equal(account.name, "테스트 사용자");
			assert.equal(dropbox.accountEmail, "user@example.com");
			assert.equal(await dropbox.getRefreshToken(), fake.refreshToken);
		});
		
		it("should connect an account with a pasted code", async function () {
			var { url, verifier, redirectURI, codePromise } = await dropbox.startAuthorization({
				manual: true
			});
			url = new URL(url);
			assert.isNull(url.searchParams.get('redirect_uri'));
			assert.isNull(redirectURI);
			assert.isNull(codePromise);
			fake.codeChallenge = url.searchParams.get('code_challenge');
			await dropbox.completeAuthorization(" " + fake.authCode + "\n", verifier, redirectURI);
			assert.isTrue(await dropbox.isConnected());
		});
		
		it("should explain a rejected authorization code", async function () {
			var { url, verifier } = await dropbox.startAuthorization({ manual: true });
			fake.codeChallenge = new URL(url).searchParams.get('code_challenge');
			var e = await getPromiseError(dropbox.completeAuthorization("wrong-code", verifier, null));
			assert.equal(
				e.message,
				Zotero.ftl.formatValueSync('sync-storage-dropbox-error-authorization-failed')
			);
			assert.isFalse(await dropbox.isConnected());
		});
		
		it("should ignore a redirect for a different authorization", async function () {
			var { codePromise } = await dropbox.startAuthorization();
			var redirect = `http://127.0.0.1:${Zotero.Prefs.get('httpServer.port')}`
				+ `${dropbox.REDIRECT_PATH}?state=wrong&code=${fake.authCode}`;
			var xmlhttp = await Zotero.HTTP.request("GET", redirect, { successCodes: [400] });
			assert.equal(xmlhttp.status, 400);
			dropbox.cancelAuthorization();
			var e = await getPromiseError(codePromise);
			assert.instanceOf(e, Zotero.Sync.UserCancelledException);
		});
		
		it("should reject a denied authorization", async function () {
			var { url, codePromise } = await dropbox.startAuthorization();
			var state = new URL(url).searchParams.get('state');
			assert.isFalse(dropbox.handleRedirect(new URLSearchParams({ state, error: 'access_denied' })));
			var e = await getPromiseError(codePromise);
			assert.instanceOf(e, Zotero.Sync.UserCancelledException);
		});
		
		it("should forget the authorization on disconnect", async function () {
			await dropbox.setRefreshToken(fake.refreshToken);
			Zotero.Prefs.set('sync.storage.dropbox.accountEmail', "user@example.com");
			await dropbox.disconnect();
			assert.isFalse(await dropbox.isConnected());
			assert.equal(dropbox.accountEmail, "");
			assert.include(fake.requests, 'auth/token/revoke');
		});
	});
	
	
	describe("Settings", function () {
		var prefWin;
		
		beforeEach(async function () {
			// Logged in, without network requests
			stubs.push(sinon.stub(Zotero.Sync.Data.Local, 'getAPIKey').resolves('x'.repeat(24)));
			stubs.push(sinon.stub(Zotero.Sync.Runner, 'checkAccess').resolves({ username: 'testuser', emails: [] }));
			prefWin = await loadPrefPane('account');
		});
		
		afterEach(function () {
			prefWin.close();
		});
		
		async function waitFor(cb) {
			var result = await waitForCallback(cb, 10, 3);
			if (result instanceof Error) {
				throw result;
			}
		}
		
		it("should offer to connect again while connected", async function () {
			var doc = prefWin.document;
			await waitFor(() => !doc.getElementById('storage-dropbox-verify').hidden);
			assert.isFalse(doc.getElementById('storage-dropbox-reconnect').hidden);
			assert.isTrue(doc.getElementById('storage-dropbox-connect').hidden);
		});
		
		it("should offer to connect again when the authorization lacks a permission", async function () {
			fake.failures['files/download'] = [{
				status: 401,
				body: {
					error_summary: "missing_scope/..",
					error: { ".tag": "missing_scope", required_scope: "files.content.read" }
				}
			}];
			var sync = prefWin.Zotero_Preferences.Sync;
			var confirmStub = sinon.stub(Zotero.Prompt, 'confirm').returns(0);
			stubs.push(confirmStub);
			var connectStub = sinon.stub(sync, 'connectDropbox').resolves();
			stubs.push(connectStub);
			
			assert.isFalse(await sync.verifyDropbox());
			assert.isTrue(confirmStub.calledOnce);
			assert.include(confirmStub.firstCall.args[0].text, "files.content.read");
			assert.isTrue(connectStub.calledOnce);
		});
		
		it("shouldn't connect again if the user cancels", async function () {
			fake.failures['files/download'] = [{
				status: 401,
				body: {
					error_summary: "missing_scope/..",
					error: { ".tag": "missing_scope", required_scope: "files.content.read" }
				}
			}];
			var sync = prefWin.Zotero_Preferences.Sync;
			stubs.push(sinon.stub(Zotero.Prompt, 'confirm').returns(1));
			var connectStub = sinon.stub(sync, 'connectDropbox').resolves();
			stubs.push(connectStub);
			
			assert.isFalse(await sync.verifyDropbox());
			assert.isFalse(connectStub.called);
		});
	});
	
	
	describe("#checkServer()", function () {
		it("should create the folder and verify file access", async function () {
			await controller.checkServer();
			assert.isTrue(controller.verified);
			assert.isTrue(fake.folders.has('/zotero'));
			assert.isFalse(fake.files.has('/zotero/zotero-test-file.prop'));
			assert.equal(dropbox.accountName, "테스트 사용자");
		});
		
		it("should require a connected account", async function () {
			await dropbox._writeRefreshToken(null, null);
			var e = await getPromiseError(controller.checkServer());
			assert.instanceOf(e, controller.VerificationError);
			assert.equal(e.error, "NOT_CONNECTED");
			assert.isFalse(controller.verified);
		});
		
		it("should reject a file in place of the folder", async function () {
			addFile('/zotero', "not a folder");
			var e = await getPromiseError(controller.checkServer());
			assert.equal(e.error, "NOT_A_FOLDER");
		});
	});
	
	
	describe("Syncing", function () {
		it("should skip downloads if not marked as needed", async function () {
			var engine = await setup();
			
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			await library.saveTx();
			
			var result = await engine.start();
			
			assert.lengthOf(fake.requests, 0);
			assert.isFalse(result.localChanges);
			assert.isFalse(result.remoteChanges);
			assert.isFalse(result.syncRequired);
			assert.equal(library.storageVersion, library.libraryVersion);
		});
		
		it("should ignore a remotely missing file", async function () {
			var engine = await setup();
			
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			await library.saveTx();
			library.storageDownloadNeeded = true;
			
			var item = new Zotero.Item("attachment");
			item.attachmentLinkMode = 'imported_file';
			item.attachmentPath = 'storage:test.txt';
			item.attachmentSyncState = "to_download";
			await item.saveTx();
			
			var result = await engine.start();
			
			assert.isFalse(result.localChanges);
			assert.isFalse(library.storageDownloadNeeded);
			assert.equal(item.attachmentSyncState, Zotero.Sync.Storage.Local.SYNC_STATE_IN_SYNC);
		});
		
		it("should download a missing file", async function () {
			var engine = await setup();
			
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			await library.saveTx();
			library.storageDownloadNeeded = true;
			
			var fileName = "논문 원문.txt";
			var item = new Zotero.Item("attachment");
			item.attachmentLinkMode = 'imported_file';
			item.attachmentPath = 'storage:' + fileName;
			item.attachmentSyncState = "to_download";
			await item.saveTx();
			
			var text = Zotero.Utilities.randomString();
			var mtime = 1441252524905;
			addFile(`/zotero/${item.key}.zip`, await createZip(fileName, text));
			addFile(`/zotero/${item.key}.prop`, propText(mtime, Zotero.Utilities.Internal.md5(text)));
			
			var result = await engine.start();
			
			assert.isTrue(result.localChanges);
			assert.isFalse(result.remoteChanges);
			var path = await item.getFilePathAsync();
			assert.equal(await Zotero.File.getContentsAsync(path), text);
			assert.equal(await item.attachmentModificationTime, mtime);
			assert.equal(item.attachmentSyncedModificationTime, mtime);
			assert.equal(item.attachmentSyncState, Zotero.Sync.Storage.Local.SYNC_STATE_IN_SYNC);
			assert.isFalse(library.storageDownloadNeeded);
			assert.equal(library.storageVersion, library.libraryVersion);
		});
		
		it("should delete an orphaned .prop file if the .zip is missing", async function () {
			var engine = await setup();
			
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			await library.saveTx();
			library.storageDownloadNeeded = true;
			
			var item = new Zotero.Item("attachment");
			item.attachmentLinkMode = 'imported_file';
			item.attachmentPath = 'storage:test.txt';
			item.attachmentSyncState = "to_download";
			await item.saveTx();
			addFile(`/zotero/${item.key}.prop`, propText(1441252524905, "8286300a280f64a4b5cfaac547c21d32"));
			
			await engine.start();
			
			assert.isFalse(fake.files.has(`/zotero/${item.key}.prop`.toLowerCase()));
			assert.equal(item.attachmentSyncState, Zotero.Sync.Storage.Local.SYNC_STATE_IN_SYNC);
		});
		
		it("should upload new files", async function () {
			var engine = await setup();
			
			var file = getTestDataDirectory();
			file.append('test.png');
			var item = await Zotero.Attachments.importFromFile({ file });
			item.synced = true;
			await item.saveTx();
			var mtime = await item.attachmentModificationTime;
			var hash = await item.attachmentHash;
			
			var result = await engine.start();
			
			assert.isTrue(result.localChanges);
			assert.isTrue(result.remoteChanges);
			assert.isTrue(result.syncRequired);
			
			var zip = fake.files.get(`/zotero/${item.key}.zip`.toLowerCase());
			assert.ok(zip);
			assert.sameMembers(await getZipEntries(zip.content), ['test.png']);
			assert.equal(getFileText(`/zotero/${item.key}.prop`), propText(mtime, hash));
			
			assert.equal(item.attachmentSyncState, Zotero.Sync.Storage.Local.SYNC_STATE_IN_SYNC);
			assert.equal(item.attachmentSyncedModificationTime, mtime);
			assert.equal(item.attachmentSyncedHash, hash);
			// The new file properties still have to be sent to the API
			assert.isFalse(item.synced);
			
			// The temporary ZIP file is removed
			assert.isFalse(await IOUtils.exists(
				PathUtils.join(Zotero.getTempDirectory().path, item.key + '.zip')
			));
		});
		
		it("should skip the upload if Dropbox already has the file", async function () {
			var engine = await setup();
			
			var file = getTestDataDirectory();
			file.append('test.png');
			var item = await Zotero.Attachments.importFromFile({ file });
			item.synced = true;
			await item.saveTx();
			var mtime = await item.attachmentModificationTime;
			var hash = await item.attachmentHash;
			addFile(`/zotero/${item.key}.prop`, propText(mtime, hash));
			
			var result = await engine.start();
			
			assert.isTrue(result.localChanges);
			assert.isFalse(result.remoteChanges);
			assert.isTrue(result.syncRequired);
			assert.notInclude(fake.requests, 'files/upload');
			assert.equal(item.attachmentSyncState, Zotero.Sync.Storage.Local.SYNC_STATE_IN_SYNC);
			assert.equal(item.attachmentSyncedHash, hash);
		});
		
		it("should mark a file in conflict if Dropbox has a different version", async function () {
			var engine = await setup();
			
			var file = getTestDataDirectory();
			file.append('test.png');
			var item = await Zotero.Attachments.importFromFile({ file });
			item.synced = true;
			await item.saveTx();
			var remoteMtime = (await item.attachmentModificationTime) + 5000;
			addFile(`/zotero/${item.key}.prop`, propText(remoteMtime, "4f69f43d8ac8788190b13ff7f4a0a915"));
			
			
			var result = await engine.start();
			
			assert.isFalse(result.localChanges);
			assert.isFalse(result.remoteChanges);
			assert.isTrue(result.fileSyncRequired);
			assert.isTrue(item.synced);
			assert.equal(item.attachmentSyncState, Zotero.Sync.Storage.Local.SYNC_STATE_IN_CONFLICT);
			assert.equal(item.attachmentSyncedModificationTime, remoteMtime);
			assert.notInclude(fake.requests, 'files/upload');
		});
		
		it("should show a clear error when Dropbox is full", async function () {
			var engine = await setup();
			
			var file = getTestDataDirectory();
			file.append('test.png');
			var item = await Zotero.Attachments.importFromFile({ file });
			item.synced = true;
			await item.saveTx();
			fake.failures['files/upload'] = [{
				status: 409,
				body: {
					error_summary: "path/insufficient_space/..",
					error: { ".tag": "path", reason: { ".tag": "insufficient_space" } }
				}
			}];
			
			var e = await getPromiseError(engine.start());
			assert.equal(
				e.message,
				Zotero.ftl.formatValueSync('sync-storage-dropbox-error-insufficient-space')
			);
			assert.equal(item.attachmentSyncState, Zotero.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD);
		});
		
		it("should verify the server before the first sync", async function () {
			assert.isFalse(controller.verified);
			var engine = new Zotero.Sync.Storage.Engine({
				libraryID: Zotero.Libraries.userLibraryID,
				controller,
				stopOnError: true
			});
			await engine.start();
			assert.isTrue(controller.verified);
		});
		
		it("should show a verification error if Dropbox isn't connected", async function () {
			await dropbox._writeRefreshToken(null, null);
			var engine = new Zotero.Sync.Storage.Engine({
				libraryID: Zotero.Libraries.userLibraryID,
				controller,
				stopOnError: true
			});
			var e = await getPromiseError(engine.start());
			assert.equal(
				e.message,
				Zotero.getString('sync.storage.error.verificationFailed', "Dropbox")
			);
		});
	});
	
	
	describe("#purgeDeletedStorageFiles()", function () {
		it("should delete files in Dropbox that were deleted locally", async function () {
			var engine = await setup();
			
			var file = getTestDataDirectory();
			file.append('test.png');
			var item = await Zotero.Attachments.importFromFile({ file });
			await engine.start();
			assert.isTrue(fake.files.has(`/zotero/${item.key}.zip`.toLowerCase()));
			
			await item.eraseTx();
			var deleted = await Zotero.Sync.Storage.Local.getDeletedFiles(item.libraryID);
			assert.sameMembers(deleted, [item.key]);
			
			var results = await controller.purgeDeletedStorageFiles(item.libraryID);
			assert.sameMembers(results.deleted, [`${item.key}.zip`, `${item.key}.prop`]);
			assert.isFalse(fake.files.has(`/zotero/${item.key}.zip`.toLowerCase()));
			assert.isFalse(fake.files.has(`/zotero/${item.key}.prop`.toLowerCase()));
			assert.lengthOf(await Zotero.Sync.Storage.Local.getDeletedFiles(item.libraryID), 0);
		});
		
		it("should clear files that were never uploaded from the delete log", async function () {
			var file = getTestDataDirectory();
			file.append('test.png');
			var item = await Zotero.Attachments.importFromFile({ file });
			await item.eraseTx();
			
			var results = await controller.purgeDeletedStorageFiles(item.libraryID);
			assert.sameMembers(results.missing, [`${item.key}.zip`, `${item.key}.prop`]);
			assert.lengthOf(await Zotero.Sync.Storage.Local.getDeletedFiles(item.libraryID), 0);
		});
	});
	
	
	describe("#purgeOrphanedStorageFiles()", function () {
		it("should delete orphaned files more than a week older than the last sync time", async function () {
			await controller.checkServer();
			var library = Zotero.Libraries.userLibrary;
			library.updateLastSyncTime();
			await library.saveTx();
			
			var item = await createDataObject('item');
			var old = new Date(Date.now() - 8 * 86400 * 1000);
			addFile(`/zotero/${item.key}.zip`, "a", old);
			addFile(`/zotero/${item.key}.prop`, "a", old);
			addFile('/zotero/BBBBBBBB.zip', "b", old);
			addFile('/zotero/BBBBBBBB.prop', "b", old);
			addFile('/zotero/CCCCCCCC.zip', "c");
			addFile('/zotero/notes.txt', "d", old);
			
			var results = await controller.purgeOrphanedStorageFiles();
			assert.sameMembers(results.deleted, ['BBBBBBBB.zip', 'BBBBBBBB.prop']);
			assert.isTrue(fake.files.has(`/zotero/${item.key}.zip`.toLowerCase()));
			assert.isTrue(fake.files.has('/zotero/cccccccc.zip'));
			assert.isTrue(fake.files.has('/zotero/notes.txt'));
			// Listing used more than one page
			assert.include(fake.requests, 'files/list_folder/continue');
		});
		
		it("shouldn't purge if purged recently", async function () {
			Zotero.Prefs.set('lastDropboxOrphanPurge', Math.round(Date.now() / 1000) - 3600);
			assert.isFalse(await controller.purgeOrphanedStorageFiles());
			assert.lengthOf(fake.requests, 0);
		});
	});
	
	
	describe("Storage mode", function () {
		it("should be selected by the sync.storage.protocol pref", function () {
			var libraryID = Zotero.Libraries.userLibraryID;
			assert.equal(Zotero.Sync.Storage.Local.getModeForLibrary(libraryID), 'dropbox');
			assert.equal(
				Zotero.Sync.Storage.Local.getClassForLibrary(libraryID),
				Zotero.Sync.Storage.Mode.Dropbox
			);
			assert.isTrue(Zotero.Sync.Storage.Utilities.usesClientManagedStorage('dropbox'));
			assert.isTrue(Zotero.Sync.Storage.Utilities.usesClientManagedStorage('webdav'));
			assert.isFalse(Zotero.Sync.Storage.Utilities.usesClientManagedStorage('zfs'));
		});
		
		it("should keep using Zotero Storage for group libraries", async function () {
			var group = await createGroup();
			assert.equal(Zotero.Sync.Storage.Local.getModeForLibrary(group.libraryID), 'zfs');
		});
		
		it("should log deleted files for purging", async function () {
			var file = getTestDataDirectory();
			file.append('test.png');
			var item = await Zotero.Attachments.importFromFile({ file });
			await item.eraseTx();
			assert.include(await Zotero.Sync.Storage.Local.getDeletedFiles(item.libraryID), item.key);
		});
	});
});
