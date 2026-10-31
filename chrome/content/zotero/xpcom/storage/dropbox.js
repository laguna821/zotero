/*
    ***** BEGIN LICENSE BLOCK *****

    Copyright © 2026 laguna821 (https://github.com/laguna821/zotero)

    This file is part of Zotero.

    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.

    ***** END LICENSE BLOCK *****
*/

// Dropbox API parameters and responses use snake_case
/* eslint-disable camelcase */

Components.utils.importGlobalProperties(["File", "crypto"]);

if (!Zotero.Sync.Storage.Mode) {
	Zotero.Sync.Storage.Mode = {};
}


/**
 * Dropbox API access shared by all Dropbox storage controllers
 *
 * Authorization uses the OAuth 2 code flow with PKCE, so the Dropbox app needs no secret. The
 * refresh token is kept in the login manager, encrypted with the OS key store like other
 * credentials, and short-lived access tokens are kept only in memory.
 */
Zotero.Sync.Storage.Dropbox = {
	AUTHORIZE_URL: "https://www.dropbox.com/oauth2/authorize",
	TOKEN_URL: "https://api.dropboxapi.com/oauth2/token",
	API_URL: "https://api.dropboxapi.com/2/",
	CONTENT_URL: "https://content.dropboxapi.com/2/",
	REDIRECT_PATH: "/dropbox/oauth",
	APP_CONSOLE_URL: "https://www.dropbox.com/developers/apps",
	
	// files/upload accepts up to 150 MB; larger files go through an upload session
	SINGLE_UPLOAD_MAX_SIZE: 140 * 1024 * 1024,
	// Must be a multiple of 4 MB
	UPLOAD_CHUNK_SIZE: 32 * 1024 * 1024,
	// Refresh access tokens this many seconds before they expire
	TOKEN_EXPIRY_MARGIN: 300,
	AUTHORIZATION_TIMEOUT: 15 * 60 * 1000,
	WRITE_CONFLICT_DELAYS: [1000, 2000, 4000, 8000],
	
	ERROR_DELAY_INTERVALS: [2500, 5000],
	ERROR_DELAY_MAX: 15000,
	
	_loginManagerHost: 'chrome://zotero',
	_loginManagerRealm: 'Zotero Dropbox (encrypted)',
	
	_accessToken: null,
	_accessTokenExpiration: 0,
	_refreshPromise: null,
	_pendingAuthorization: null,
	
	
	/**
	 * Error from a Dropbox endpoint
	 *
	 * 'status' is the HTTP status, 'summary' the Dropbox 'error_summary' (e.g.,
	 * "path/not_found/.."), and 'error' the Dropbox 'error' object.
	 */
	APIError: class extends Error {
		constructor(status, summary, error, endpoint) {
			super(`Dropbox API error ${status}${endpoint ? ` from ${endpoint}` : ''}: ${summary}`);
			this.name = "DropboxAPIError";
			this.status = status;
			this.summary = summary || "";
			this.error = error || null;
			this.endpoint = endpoint;
		}
		
		is(prefix) {
			return this.summary.startsWith(prefix);
		}
	},
	
	
	get appKey() {
		return (Zotero.Prefs.get('sync.storage.dropbox.appKey') || '').trim();
	},
	
	
	/**
	 * Folder for attachment files, relative to the root of the app's access -- the app folder for
	 * apps with "App folder" access
	 */
	get folder() {
		var folder = (Zotero.Prefs.get('sync.storage.dropbox.folder') || '')
			.trim()
			.replace(/\/{2,}/g, '/')
			.replace(/^\/|\/$/g, '');
		return '/' + (folder || 'zotero');
	},
	
	
	get redirectURI() {
		return `http://localhost:${Zotero.Prefs.get('httpServer.port')}${this.REDIRECT_PATH}`;
	},
	
	
	get accountName() {
		return Zotero.Prefs.get('sync.storage.dropbox.accountName') || '';
	},
	
	
	get accountEmail() {
		return Zotero.Prefs.get('sync.storage.dropbox.accountEmail') || '';
	},
	
	
	//
	// Credentials
	//
	async getRefreshToken() {
		var appKey = this.appKey;
		if (!appKey) {
			return null;
		}
		var logins = await Services.logins.searchLoginsAsync({
			origin: this._loginManagerHost,
			httpRealm: this._loginManagerRealm
		});
		for (let login of logins) {
			if (login.username == appKey) {
				return Zotero.OSKeyStore.decrypt(login.password);
			}
		}
		return null;
	},
	
	
	/**
	 * Store the refresh token for the current app key, falling back to unencrypted storage only
	 * if the user agrees, as for WebDAV passwords
	 */
	async setRefreshToken(token) {
		var appKey = this.appKey;
		if (!appKey) {
			throw new Error("Dropbox app key not set");
		}
		if (!token) {
			await this._writeRefreshToken(appKey, null);
			return;
		}
		var error;
		try {
			await this._writeRefreshToken(appKey, await Zotero.OSKeyStore.encrypt(token));
			return;
		}
		catch (e) {
			Zotero.logError(e);
			error = e;
		}
		if (Zotero.Sync.Data.Local.repairLoginManager()) {
			try {
				await this._writeRefreshToken(appKey, await Zotero.OSKeyStore.encrypt(token));
				return;
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		if (Zotero.OSKeyStore.isEncrypted(token) || !Zotero.OSKeyStore.confirmUnencryptedFallback()) {
			throw error;
		}
		await this._writeRefreshToken(appKey, token);
	},
	
	
	async _writeRefreshToken(appKey, storedValue) {
		var logins = await Services.logins.searchLoginsAsync({
			origin: this._loginManagerHost,
			httpRealm: this._loginManagerRealm
		});
		for (let login of logins) {
			if (appKey === null || login.username == appKey) {
				Services.logins.removeLogin(login);
			}
		}
		if (storedValue) {
			let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
				Components.interfaces.nsILoginInfo, "init");
			let loginInfo = new nsLoginInfo(this._loginManagerHost, null,
				this._loginManagerRealm, appKey, storedValue, "", "");
			await Services.logins.addLoginAsync(loginInfo);
		}
	},
	
	
	async isConnected() {
		try {
			return !!(await this.getRefreshToken());
		}
		catch (e) {
			Zotero.logError(e);
			return false;
		}
	},
	
	
	/**
	 * Get a valid access token, refreshing it if necessary
	 *
	 * Concurrent callers share a single refresh request.
	 */
	async getAccessToken(options = {}) {
		if (!options.forceRefresh
				&& this._accessToken
				&& Date.now() < this._accessTokenExpiration - this.TOKEN_EXPIRY_MARGIN * 1000) {
			return this._accessToken;
		}
		if (!this._refreshPromise) {
			this._refreshPromise = this._refreshAccessToken(options)
				.finally(() => {
					this._refreshPromise = null;
				});
		}
		return this._refreshPromise;
	},
	
	
	async _refreshAccessToken(options) {
		var appKey = this.appKey;
		if (!appKey) {
			throw this.authError('NO_APP_KEY');
		}
		var refreshToken = await this.getRefreshToken();
		if (!refreshToken) {
			throw this.authError('NOT_CONNECTED');
		}
		Zotero.debug("Refreshing Dropbox access token");
		var json = await this._tokenRequest(
			{
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: appKey
			},
			options
		);
		this._setAccessToken(json);
		return this._accessToken;
	},
	
	
	_setAccessToken(json) {
		if (!json || !json.access_token) {
			throw new Error("Access token not returned by Dropbox");
		}
		this._accessToken = json.access_token;
		// Dropbox currently issues four-hour tokens
		this._accessTokenExpiration = Date.now() + (parseInt(json.expires_in) || 14400) * 1000;
	},
	
	
	clearAccessToken() {
		this._accessToken = null;
		this._accessTokenExpiration = 0;
	},
	
	
	async _tokenRequest(params, options = {}) {
		var xmlhttp;
		try {
			xmlhttp = await Zotero.HTTP.request("POST", this.TOKEN_URL, {
				body: new URLSearchParams(params).toString(),
				headers: {
					"Content-Type": "application/x-www-form-urlencoded"
				},
				responseType: 'text',
				// Don't log authorization codes, verifiers, or refresh tokens
				logBodyLength: 0,
				successCodes: [200],
				errorDelayIntervals: options.errorDelayIntervals || this.ERROR_DELAY_INTERVALS,
				errorDelayMax: options.errorDelayMax !== undefined
					? options.errorDelayMax
					: this.ERROR_DELAY_MAX,
				timeout: 30000
			});
		}
		catch (e) {
			if (e instanceof Zotero.HTTP.UnexpectedStatusException && e.is4xx()) {
				let json = this._parseJSON(e.xmlhttp.responseText);
				Zotero.debug("Dropbox token request failed: "
					+ (json ? json.error + " " + (json.error_description || "") : e.status), 2);
				if (json && json.error == 'invalid_grant' && params.grant_type == 'refresh_token') {
					this.clearAccessToken();
					throw this.authError('AUTH_REVOKED');
				}
				if (json && json.error) {
					throw new this.APIError(e.status, json.error, json, 'oauth2/token');
				}
			}
			throw e;
		}
		return JSON.parse(xmlhttp.responseText);
	},
	
	
	//
	// Authorization
	//
	/**
	 * Start an authorization in the user's browser
	 *
	 * @param {Object} [options]
	 * @param {Boolean} [options.manual] - Have Dropbox show a code for the user to paste instead
	 *     of redirecting back to the local HTTP server
	 * @return {Promise<Object>} - { url, verifier, redirectURI, codePromise }; codePromise
	 *     resolves with the authorization code when Dropbox redirects back
	 */
	async startAuthorization(options = {}) {
		var appKey = this.appKey;
		if (!appKey) {
			throw this.authError('NO_APP_KEY');
		}
		this.cancelAuthorization();
		
		var verifier = this._randomString(64);
		var state = this._randomString(32);
		var redirectURI = options.manual ? null : this.redirectURI;
		
		var params = new URLSearchParams({
			client_id: appKey,
			response_type: 'code',
			token_access_type: 'offline',
			code_challenge: await this._getCodeChallenge(verifier),
			code_challenge_method: 'S256'
		});
		if (redirectURI) {
			params.set('redirect_uri', redirectURI);
			params.set('state', state);
		}
		var url = this.AUTHORIZE_URL + '?' + params.toString();
		
		var codePromise = null;
		if (redirectURI) {
			codePromise = new Promise((resolve, reject) => {
				let pending = { state, resolve, reject };
				pending.timer = setTimeout(() => {
					if (this._pendingAuthorization === pending) {
						this._pendingAuthorization = null;
						reject(new Error("Dropbox authorization timed out"));
					}
				}, this.AUTHORIZATION_TIMEOUT);
				this._pendingAuthorization = pending;
			});
		}
		
		return { url, verifier, redirectURI, codePromise };
	},
	
	
	cancelAuthorization() {
		var pending = this._pendingAuthorization;
		if (!pending) {
			return;
		}
		this._pendingAuthorization = null;
		clearTimeout(pending.timer);
		pending.reject(new Zotero.Sync.UserCancelledException());
	},
	
	
	/**
	 * Handle the redirect from Dropbox to the local HTTP server
	 *
	 * @param {URLSearchParams} searchParams
	 * @return {Boolean} - True if an authorization code was received for a pending authorization
	 */
	handleRedirect(searchParams) {
		var pending = this._pendingAuthorization;
		var state = searchParams.get('state');
		if (!pending || !state || state !== pending.state) {
			Zotero.debug("Ignoring Dropbox redirect without a matching authorization", 2);
			return false;
		}
		this._pendingAuthorization = null;
		clearTimeout(pending.timer);
		
		var error = searchParams.get('error');
		if (error) {
			Zotero.debug(`Dropbox authorization failed: ${error} `
				+ (searchParams.get('error_description') || ''), 2);
			pending.reject(error == 'access_denied'
				? new Zotero.Sync.UserCancelledException()
				: new this.APIError(400, error, null, 'oauth2/authorize'));
			return false;
		}
		var code = searchParams.get('code');
		if (!code) {
			pending.reject(new Error("Authorization code not returned by Dropbox"));
			return false;
		}
		pending.resolve(code);
		return true;
	},
	
	
	/**
	 * Exchange an authorization code for tokens and store the refresh token
	 *
	 * @return {Promise<Object|null>} - Account info, or null if it couldn't be retrieved
	 */
	async completeAuthorization(code, verifier, redirectURI) {
		var params = {
			code: code.trim(),
			grant_type: 'authorization_code',
			code_verifier: verifier,
			client_id: this.appKey
		};
		if (redirectURI) {
			params.redirect_uri = redirectURI;
		}
		var json;
		try {
			json = await this._tokenRequest(params, { errorDelayMax: 0 });
		}
		catch (e) {
			// E.g., a mistyped or expired code, or an app key for a different app
			if (e instanceof this.APIError && e.status == 400) {
				Zotero.logError(e);
				throw new Zotero.Error(
					Zotero.ftl.formatValueSync('sync-storage-dropbox-error-authorization-failed'),
					0,
					{ dialogButtonText: null }
				);
			}
			throw e;
		}
		if (!json.refresh_token) {
			throw new Error("Refresh token not returned by Dropbox");
		}
		await this.setRefreshToken(json.refresh_token);
		this._setAccessToken(json);
		Zotero.Prefs.set('sync.storage.dropbox.verified', false);
		
		try {
			return await this.updateAccountInfo({ errorDelayMax: 0 });
		}
		catch (e) {
			// Account info is only used for display
			Zotero.logError(e);
			return null;
		}
	},
	
	
	/**
	 * Revoke and forget the stored authorization
	 */
	async disconnect() {
		this.cancelAuthorization();
		try {
			if (await this.isConnected()) {
				let token = await this.getAccessToken({ errorDelayMax: 0 });
				await Zotero.HTTP.request("POST", this.API_URL + 'auth/token/revoke', {
					headers: {
						Authorization: "Bearer " + token
					},
					successCodes: [200, 401],
					errorDelayMax: 0,
					timeout: 15000
				});
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
		this.clearAccessToken();
		await this._writeRefreshToken(null, null);
		Zotero.Prefs.clear('sync.storage.dropbox.accountName');
		Zotero.Prefs.clear('sync.storage.dropbox.accountEmail');
		Zotero.Prefs.set('sync.storage.dropbox.verified', false);
	},
	
	
	async getCurrentAccount(options) {
		var json = await this.rpc('users/get_current_account', null, options);
		return {
			accountID: json.account_id,
			name: (json.name && json.name.display_name) || '',
			email: json.email || ''
		};
	},
	
	
	async updateAccountInfo(options) {
		var account = await this.getCurrentAccount(options);
		Zotero.Prefs.set('sync.storage.dropbox.accountName', account.name);
		Zotero.Prefs.set('sync.storage.dropbox.accountEmail', account.email);
		return account;
	},
	
	
	//
	// API requests
	//
	/**
	 * Make an RPC request (JSON in, JSON out)
	 *
	 * @param {String} endpoint - e.g., 'files/get_metadata'
	 * @param {Object|null} args
	 * @param {Object} [options]
	 * @return {Promise<Object>}
	 * @throws {Zotero.Sync.Storage.Dropbox.APIError} - For endpoint-specific (409) errors
	 */
	async rpc(endpoint, args, options = {}) {
		return this._withRetries(() => this._authorizedRequest(async (token) => {
			let headers = {
				Authorization: "Bearer " + token
			};
			let body = null;
			if (args !== null && args !== undefined) {
				headers["Content-Type"] = "application/json";
				body = JSON.stringify(args);
			}
			let xmlhttp = await Zotero.HTTP.request(
				"POST",
				this.API_URL + endpoint,
				Object.assign(this._httpOptions(options), {
					headers,
					body,
					responseType: 'text',
					successCodes: [200, 409]
				})
			);
			return this._handleResponse(xmlhttp.status, xmlhttp.responseText, endpoint);
		}, options));
	},
	
	
	/**
	 * Make a content-upload request
	 *
	 * @param {String} endpoint
	 * @param {Object} args - Passed in the Dropbox-API-Arg header
	 * @param {Blob|File|Uint8Array|null} body - Not a string, which XHR would send with a charset
	 *     that Dropbox rejects
	 * @param {Object} [options]
	 * @param {Function} [options.onUploadProgress] - f(loaded, total) for this request body
	 */
	async contentUpload(endpoint, args, body, options = {}) {
		return this._withRetries(() => this._authorizedRequest(async (token) => {
			let xmlhttp = await Zotero.HTTP.request(
				"POST",
				this.CONTENT_URL + endpoint,
				Object.assign(this._httpOptions(options), {
					headers: {
						Authorization: "Bearer " + token,
						"Content-Type": "application/octet-stream",
						"Dropbox-API-Arg": this.headerSafeJSON(args)
					},
					body,
					responseType: 'text',
					successCodes: [200, 409],
					requestObserver: (xmlhttp) => {
						if (options.requestObserver) {
							options.requestObserver(xmlhttp);
						}
						if (options.onUploadProgress) {
							xmlhttp.upload.addEventListener("progress", (event) => {
								if (event.lengthComputable) {
									options.onUploadProgress(event.loaded, event.total);
								}
							});
						}
					},
					// Uploads can take a long time
					timeout: 0
				})
			);
			return this._handleResponse(xmlhttp.status, xmlhttp.responseText, endpoint);
		}, options));
	},
	
	
	/**
	 * Upload data to a path, replacing any existing file
	 */
	async upload(path, body, options = {}) {
		return this.contentUpload(
			'files/upload',
			{
				path,
				mode: 'overwrite',
				autorename: false,
				mute: true,
				strict_conflict: false
			},
			body,
			options
		);
	},
	
	
	/**
	 * Upload a file from disk, using an upload session for large files
	 *
	 * @param {String} path - Dropbox path
	 * @param {String} filePath - Local path
	 * @param {Object} [options]
	 * @param {Function} [options.onProgress] - f(loaded, total) for the whole file
	 */
	async uploadFile(path, filePath, options = {}) {
		var file = await File.createFromFileName(filePath);
		var size = file.size;
		var report = (loaded) => {
			if (options.onProgress) {
				options.onProgress(Math.min(loaded, size), size);
			}
		};
		
		if (size <= this.SINGLE_UPLOAD_MAX_SIZE) {
			return this.upload(path, file, Object.assign({}, options, {
				onUploadProgress: loaded => report(loaded)
			}));
		}
		
		Zotero.debug(`Uploading ${size} bytes to Dropbox in an upload session`);
		var chunkSize = this.UPLOAD_CHUNK_SIZE;
		var offset = Math.min(chunkSize, size);
		var chunkOptions = base => Object.assign({}, options, {
			onUploadProgress: loaded => report(base + loaded)
		});
		var sessionID = (await this.contentUpload(
			'files/upload_session/start',
			{ close: false },
			file.slice(0, offset),
			chunkOptions(0)
		)).session_id;
		while (size - offset > chunkSize) {
			let end = offset + chunkSize;
			try {
				await this.contentUpload(
					'files/upload_session/append_v2',
					{ cursor: { session_id: sessionID, offset }, close: false },
					file.slice(offset, end),
					chunkOptions(offset)
				);
				offset = end;
			}
			catch (e) {
				// If a retried request had actually reached Dropbox, continue from the offset
				// Dropbox has
				let correctOffset = e instanceof this.APIError
					&& e.error
					&& e.error['.tag'] == 'incorrect_offset'
					&& e.error.correct_offset;
				if (correctOffset && correctOffset > offset && correctOffset <= size) {
					Zotero.debug(`Continuing Dropbox upload session at ${correctOffset}`);
					offset = correctOffset;
					continue;
				}
				throw e;
			}
		}
		return this.contentUpload(
			'files/upload_session/finish',
			{
				cursor: { session_id: sessionID, offset },
				commit: {
					path,
					mode: 'overwrite',
					autorename: false,
					mute: true,
					strict_conflict: false
				}
			},
			file.slice(offset, size),
			chunkOptions(offset)
		);
	},
	
	
	/**
	 * Download a file to disk
	 *
	 * @return {Promise<Object>} - Metadata of the downloaded file
	 * @throws {Zotero.Sync.Storage.Dropbox.APIError} - e.g., 'path/not_found'
	 */
	async downloadToFile(path, destPath, options = {}) {
		return this._authorizedRequest(async (token) => {
			let response = await Zotero.HTTP.download(
				this.CONTENT_URL + 'files/download',
				destPath,
				Object.assign(this._httpOptions(options), {
					headers: {
						Authorization: "Bearer " + token,
						"Dropbox-API-Arg": this.headerSafeJSON({ path })
					},
					successCodes: [200, 409],
					noCache: true,
					onProgress: options.onProgress,
					cancellerReceiver: options.cancellerReceiver,
					displayURL: this.CONTENT_URL + 'files/download (' + path + ')',
					// Inactivity timeout
					timeout: options.timeout || 60000
				})
			);
			if (response.status == 409) {
				return this._handleResponse(409, await response.text(), 'files/download');
			}
			return this._parseJSON(response.headers.get('Dropbox-API-Result'));
		}, options);
	},
	
	
	/**
	 * Download a small text file
	 *
	 * @return {Promise<String>}
	 */
	async downloadText(path, options = {}) {
		return this._authorizedRequest(async (token) => {
			let xmlhttp = await Zotero.HTTP.request(
				"GET",
				this.CONTENT_URL + 'files/download',
				Object.assign(this._httpOptions(options), {
					headers: {
						Authorization: "Bearer " + token,
						"Dropbox-API-Arg": this.headerSafeJSON({ path })
					},
					responseType: 'text',
					successCodes: [200, 409],
					noCache: true
				})
			);
			if (xmlhttp.status == 409) {
				return this._handleResponse(409, xmlhttp.responseText, 'files/download');
			}
			return xmlhttp.responseText;
		}, options);
	},
	
	
	/**
	 * Delete a file or folder
	 *
	 * @return {Promise<Boolean>} - False if the path didn't exist
	 */
	async delete(path, options = {}) {
		try {
			await this.rpc('files/delete_v2', { path }, options);
			return true;
		}
		catch (e) {
			if (e instanceof this.APIError && e.is('path_lookup/not_found')) {
				return false;
			}
			throw e;
		}
	},
	
	
	/**
	 * List all entries in a folder (non-recursively)
	 */
	async listFolder(path, options = {}) {
		var entries = [];
		var json = await this.rpc('files/list_folder', { path, recursive: false, limit: 2000 }, options);
		entries.push(...json.entries);
		while (json.has_more) {
			json = await this.rpc('files/list_folder/continue', { cursor: json.cursor }, options);
			entries.push(...json.entries);
		}
		return entries;
	},
	
	
	/**
	 * Encode arguments for the Dropbox-API-Arg header, which must be ASCII
	 */
	headerSafeJSON(obj) {
		return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => {
			return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
		});
	},
	
	
	_httpOptions(options) {
		return {
			requestObserver: options.requestObserver,
			errorDelayIntervals: options.errorDelayIntervals || this.ERROR_DELAY_INTERVALS,
			errorDelayMax: options.errorDelayMax !== undefined
				? options.errorDelayMax
				: this.ERROR_DELAY_MAX,
			timeout: options.timeout
		};
	},
	
	
	/**
	 * Run a request with an access token, refreshing the token once if Dropbox rejects it
	 */
	async _authorizedRequest(fn, options = {}) {
		var token = await this.getAccessToken(options);
		try {
			return await fn(token);
		}
		catch (e) {
			if (!(e instanceof Zotero.HTTP.UnexpectedStatusException) || e.status != 401) {
				throw e;
			}
			let json = await this._getErrorJSON(e);
			let tag = json && json.error && json.error['.tag'];
			if (tag == 'missing_scope') {
				throw this.authError('MISSING_SCOPE', { scope: json.error.required_scope || '' });
			}
			Zotero.debug(`Dropbox returned 401 (${tag || 'unknown error'}) -- refreshing access token`);
			this.clearAccessToken();
			token = await this.getAccessToken(Object.assign({}, options, { forceRefresh: true }));
			try {
				return await fn(token);
			}
			catch (e) {
				if (e instanceof Zotero.HTTP.UnexpectedStatusException && e.status == 401) {
					this.clearAccessToken();
					throw this.authError('AUTH_REVOKED');
				}
				throw e;
			}
		}
	},
	
	
	/**
	 * Retry requests that fail because of concurrent writes to the same Dropbox
	 *
	 * Throttling (429) and server errors are retried by Zotero.HTTP.
	 */
	async _withRetries(fn) {
		for (let i = 0; ; i++) {
			try {
				return await fn();
			}
			catch (e) {
				if (i < this.WRITE_CONFLICT_DELAYS.length
						&& e instanceof this.APIError
						&& e.summary.includes('too_many_write_operations')) {
					Zotero.debug("Too many concurrent Dropbox writes -- retrying");
					await Zotero.Promise.delay(this.WRITE_CONFLICT_DELAYS[i]);
					continue;
				}
				throw e;
			}
		}
	},
	
	
	_handleResponse(status, text, endpoint) {
		if (status == 409) {
			let json = this._parseJSON(text);
			throw new this.APIError(
				409,
				(json && json.error_summary) || text,
				json && json.error,
				endpoint
			);
		}
		return text ? JSON.parse(text) : null;
	},
	
	
	async _getErrorJSON(e) {
		var xmlhttp = e.xmlhttp;
		if (!xmlhttp) {
			return null;
		}
		try {
			// fetch() Response from Zotero.HTTP.download()
			if (typeof xmlhttp.text == 'function') {
				return this._parseJSON(await xmlhttp.text());
			}
			return this._parseJSON(xmlhttp.responseText);
		}
		catch {
			return null;
		}
	},
	
	
	_parseJSON(text) {
		if (!text) {
			return null;
		}
		try {
			return JSON.parse(text);
		}
		catch {
			return null;
		}
	},
	
	
	/**
	 * Create an error for a problem the user has to fix in the settings
	 *
	 * @param {String} code - 'NO_APP_KEY', 'NOT_CONNECTED', 'AUTH_REVOKED', or 'MISSING_SCOPE'
	 */
	authError(code, args) {
		var strings = {
			NO_APP_KEY: 'sync-storage-dropbox-error-no-app-key',
			NOT_CONNECTED: 'sync-storage-dropbox-error-not-connected',
			AUTH_REVOKED: 'sync-storage-dropbox-error-auth-revoked',
			MISSING_SCOPE: 'sync-storage-dropbox-error-missing-scope'
		};
		var e = new Zotero.Error(
			Zotero.ftl.formatValueSync(strings[code], args),
			0,
			{
				dialogButtonText: Zotero.getString('sync.openSyncPreferences'),
				dialogButtonCallback: () => this.openSyncPreferences()
			}
		);
		e.dropboxError = code;
		return e;
	},
	
	
	openSyncPreferences() {
		var win = Services.wm.getMostRecentWindow("navigator:browser");
		if (win) {
			win.ZoteroPane.openPreferences('zotero-prefpane-account');
		}
	},
	
	
	_randomString(length) {
		// 64 characters, so bytes map to them without bias
		const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
		var bytes = new Uint8Array(length);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, b => chars[b % 64]).join('');
	},
	
	
	async _getCodeChallenge(verifier) {
		var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
		return btoa(String.fromCharCode(...new Uint8Array(digest)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	}
};


/**
 * Dropbox file sync
 *
 * Attachment files in My Library are stored in the same layout as WebDAV file sync -- KEY.zip
 * with the attachment files and KEY.prop with the modification time and hash -- in a folder of
 * the user's Dropbox, and file changes are tracked through the data sync as for WebDAV. The
 * folder can therefore also be served to other clients through a WebDAV bridge.
 */
Zotero.Sync.Storage.Mode.Dropbox = function (options) {
	this.options = options || {};
	this.api = Zotero.Sync.Storage.Dropbox;
	
	this.VerificationError = function (error, detail) {
		this.message = `Dropbox verification error (${error})`;
		this.error = error;
		this.detail = detail;
	};
	this.VerificationError.prototype = Object.create(Error.prototype);
};

Zotero.Sync.Storage.Mode.Dropbox.prototype = {
	mode: "dropbox",
	name: "Dropbox",
	
	ERROR_DELAY_INTERVALS: [2500, 5000],
	ERROR_DELAY_MAX: 15000,
	
	get verified() {
		return Zotero.Prefs.get("sync.storage.dropbox.verified");
	},
	set verified(val) {
		Zotero.Prefs.set("sync.storage.dropbox.verified", !!val);
	},
	
	get defaultError() {
		return Zotero.ftl.formatValueSync('sync-storage-dropbox-error-default');
	},
	
	get defaultErrorRestart() {
		return Zotero.ftl.formatValueSync('sync-storage-dropbox-error-default-restart');
	},
	
	
	cacheCredentials: async function () {
		await this.api.getAccessToken(this._requestOptions());
	},
	
	
	clearCachedCredentials: function () {
		Zotero.debug("Dropbox: Clearing cached credentials");
		this.api.clearAccessToken();
	},
	
	
	/**
	 * Begin download process for individual file
	 *
	 * @param {Zotero.Sync.Storage.Request} request
	 * @return {Promise<Zotero.Sync.Storage.Result>}
	 */
	downloadFile: async function (request) {
		var item = Zotero.Sync.Storage.Utilities.getItemFromRequest(request);
		if (!item) {
			throw new Error("Item '" + request.name + "' not found");
		}
		
		var path = item.getFilePath();
		if (!path) {
			Zotero.debug(`Cannot download file for attachment ${item.libraryKey} with no path`);
			return new Zotero.Sync.Storage.Result;
		}
		
		var metadata = await this._getStorageFileMetadata(item, request);
		
		if (!request.isRunning()) {
			Zotero.debug("Download request '" + request.name
				+ "' is no longer running after getting mod time");
			return new Zotero.Sync.Storage.Result;
		}
		
		if (!metadata) {
			Zotero.debug("Remote file not found for item " + item.libraryKey);
			item.attachmentSyncState = "in_sync";
			await item.saveTx({ skipAll: true });
			return new Zotero.Sync.Storage.Result;
		}
		
		var fileModTime = await item.attachmentModificationTime;
		if (metadata.mtime == fileModTime) {
			Zotero.debug("File mod time matches remote file -- skipping download of "
				+ item.libraryKey);
			
			var updateItem = item.attachmentSyncState != 1;
			item.attachmentSyncedModificationTime = metadata.mtime;
			item.attachmentSyncState = "in_sync";
			await item.saveTx({ skipAll: true });
			if (updateItem) {
				await item.updateSynced(false);
			}
			
			return new Zotero.Sync.Storage.Result({
				localChanges: true
			});
		}
		
		var destPath = PathUtils.join(Zotero.getTempDirectory().path, item.key + '.tmp');
		await Zotero.File.removeIfExists(destPath);
		
		try {
			await this.api.downloadToFile(
				this._getItemPath(item),
				destPath,
				this._requestOptions({
					onProgress: (progress, progressMax) => request.onProgress(progress, progressMax)
				})
			);
		}
		catch (e) {
			if (e instanceof this.api.APIError && e.is('path/not_found')) {
				let msg = "Remote ZIP file not found for item " + item.libraryKey;
				Zotero.debug(msg, 2);
				Cu.reportError(msg);
				
				// Delete the orphaned prop file
				try {
					await this._deleteStorageFiles([item.key + ".prop"]);
				}
				catch (e) {
					Zotero.logError(e);
				}
				
				item.attachmentSyncState = "in_sync";
				await item.saveTx({ skipAll: true });
				return new Zotero.Sync.Storage.Result;
			}
			throw this._getUserError(e);
		}
		
		// Don't try to process if the request has been cancelled
		if (request.isFinished()) {
			Zotero.debug("Download request " + request.name
				+ " is no longer running after file download");
			return new Zotero.Sync.Storage.Result;
		}
		
		Zotero.debug("Finished download of " + destPath);
		
		return Zotero.Sync.Storage.Local.processDownload({
			item,
			mtime: metadata.mtime,
			md5: metadata.md5,
			compressed: true
		});
	},
	
	
	uploadFile: async function (request) {
		var item = Zotero.Sync.Storage.Utilities.getItemFromRequest(request);
		var params = {
			mtime: await item.attachmentModificationTime,
			md5: await item.attachmentHash
		};
		
		var metadata = await this._getStorageFileMetadata(item, request);
		
		if (!request.isRunning()) {
			Zotero.debug("Upload request '" + request.name
				+ "' is no longer running after getting metadata");
			return new Zotero.Sync.Storage.Result;
		}
		
		// Check if file already exists in Dropbox
		if (item.attachmentSyncState
				!= Zotero.Sync.Storage.Local.SYNC_STATE_FORCE_UPLOAD) {
			if (metadata && metadata.mtime) {
				// Local file time
				let fmtime = await item.attachmentModificationTime;
				// Remote prop time
				let mtime = metadata.mtime;
				
				let changed = Zotero.Sync.Storage.Local.checkFileModTime(item, fmtime, mtime);
				if (!changed) {
					// Remote hash
					let hash = metadata.md5;
					if (hash) {
						// Local file hash
						let fhash = await item.attachmentHash;
						if (fhash != hash) {
							changed = true;
						}
					}
					
					// If Dropbox already has the file, update synced properties
					if (!changed) {
						item.attachmentSyncedModificationTime = fmtime;
						if (hash) {
							item.attachmentSyncedHash = hash;
						}
						item.attachmentSyncState = "in_sync";
						await item.saveTx({ skipAll: true });
						// skipAll doesn't mark as unsynced, so do that separately
						await item.updateSynced(false);
						return new Zotero.Sync.Storage.Result({
							localChanges: true,
							syncRequired: true
						});
					}
				}
				
				// Check for conflict between synced values and values in Dropbox, as for WebDAV.
				// This can happen if a client uploaded the file but failed before updating the
				// API, or if the file was changed identically on two computers at the same time.
				let smtime = item.attachmentSyncedModificationTime;
				if (smtime != mtime) {
					let shash = item.attachmentSyncedHash;
					if (shash && metadata.md5 && shash == metadata.md5) {
						Zotero.debug(`Last synced mod time for item ${item.libraryKey} doesn't `
							+ "match time in Dropbox but hash does -- using local file mtime");
						
						await this._setStorageFileMetadata(item);
						item.attachmentSyncedModificationTime = fmtime;
						item.attachmentSyncState = "in_sync";
						await item.saveTx({ skipAll: true });
						// skipAll doesn't mark as unsynced, so do that separately
						await item.updateSynced(false);
						
						return new Zotero.Sync.Storage.Result({
							localChanges: true,
							syncRequired: true
						});
					}
					
					Zotero.logError("Conflict -- last synced file mod time for item "
						+ item.libraryKey + " does not match time in Dropbox"
						+ " (" + smtime + " != " + mtime + ")");
					
					// Conflict resolution uses the synced mtime as the remote value, so set
					// that to the Dropbox value, since that's the one in conflict.
					item.attachmentSyncedModificationTime = mtime;
					item.attachmentSyncState = "in_conflict";
					await item.saveTx({ skipAll: true });
					
					return new Zotero.Sync.Storage.Result({
						fileSyncRequired: true
					});
				}
			}
			else {
				Zotero.debug("Remote file not found for item " + item.libraryKey);
			}
		}
		
		var created = await Zotero.Sync.Storage.Utilities.createUploadFile(request);
		if (!created) {
			return new Zotero.Sync.Storage.Result;
		}
		
		var zipPath = PathUtils.join(Zotero.getTempDirectory().path, item.key + '.zip');
		
		try {
			// Delete the .prop file before uploading the new .zip, so other clients never pair
			// the old properties with a new file
			if (metadata) {
				await this.api.delete(this._getItemPropertyPath(item), this._requestOptions({
					requestObserver: xmlhttp => request.setChannel(xmlhttp.channel)
				}));
			}
			
			await this.api.uploadFile(
				this._getItemPath(item),
				zipPath,
				this._requestOptions({
					requestObserver: xmlhttp => request.setChannel(xmlhttp.channel),
					onProgress: (progress, progressMax) => request.onProgress(progress, progressMax)
				})
			);
		}
		catch (e) {
			await Zotero.File.removeIfExists(zipPath);
			throw this._getUserError(e);
		}
		
		request.setChannel(false);
		return this._onUploadComplete(request, item, params);
	},
	
	
	/**
	 * @return {Promise}
	 * @throws {Zotero.Sync.Storage.Mode.Dropbox.VerificationError|Error}
	 */
	checkServer: async function (options = {}) {
		var api = this.api;
		if (!api.appKey) {
			throw new this.VerificationError("NO_APP_KEY");
		}
		if (!(await api.isConnected())) {
			throw new this.VerificationError("NOT_CONNECTED");
		}
		
		var requestOptions = this._requestOptions({
			requestObserver: options.onRequest,
			errorDelayMax: 0
		});
		
		// Make sure the stored authorization is still valid
		await api.getAccessToken(Object.assign({ forceRefresh: true }, requestOptions));
		
		try {
			await api.updateAccountInfo(requestOptions);
		}
		catch (e) {
			// Account info is only displayed, so don't require the account_info.read permission
			if (e.dropboxError != 'MISSING_SCOPE') {
				throw e;
			}
			Zotero.logError(e);
		}
		
		var folder = api.folder;
		try {
			let metadata = await api.rpc('files/get_metadata', { path: folder }, requestOptions);
			if (metadata['.tag'] != 'folder') {
				throw new this.VerificationError("NOT_A_FOLDER", folder);
			}
		}
		catch (e) {
			if (!(e instanceof api.APIError && e.is('path/not_found'))) {
				throw e;
			}
			Zotero.debug(`Creating Dropbox folder ${folder}`);
			try {
				await api.rpc('files/create_folder_v2', { path: folder, autorename: false }, requestOptions);
			}
			catch (e) {
				// Created in the meantime
				if (!(e instanceof api.APIError && e.is('path/conflict/folder'))) {
					throw e;
				}
			}
		}
		
		// Make sure files can be written, read, and deleted
		var testPath = folder + "/zotero-test-file.prop";
		await api.upload(testPath, new TextEncoder().encode(" "), requestOptions);
		var text = await api.downloadText(testPath, requestOptions);
		if (text !== " ") {
			throw new this.VerificationError("FILE_MISMATCH", testPath);
		}
		await api.delete(testPath, requestOptions);
		
		this.verified = true;
		Zotero.debug(this.name + " file sync is successfully set up");
	},
	
	
	/**
	 * Handle the result of verification, displaying an alert if necessary
	 *
	 * @return {Promise<Boolean>} - True if the verification eventually succeeded, false otherwise
	 */
	handleVerificationError: async function (err, window, skipSuccessMessage) {
		var errorTitle, errorMsg;
		
		if (err instanceof this.VerificationError) {
			switch (err.error) {
				case "NO_APP_KEY":
					errorMsg = Zotero.ftl.formatValueSync('sync-storage-dropbox-error-no-app-key');
					break;
				
				case "NOT_CONNECTED":
					errorMsg = Zotero.ftl.formatValueSync('sync-storage-dropbox-error-not-connected');
					break;
				
				case "NOT_A_FOLDER":
					errorMsg = Zotero.ftl.formatValueSync(
						'sync-storage-dropbox-error-not-a-folder', { folder: err.detail }
					);
					break;
				
				default:
					errorMsg = this.defaultError;
					break;
			}
		}
		else if (err.dropboxError) {
			errorMsg = err.message;
		}
		else if (err instanceof Zotero.Sync.UserCancelledException) {
			return false;
		}
		else {
			let e = this._getUserError(err);
			if (e !== err) {
				errorMsg = e.message;
			}
		}
		
		var e;
		if (errorMsg) {
			e = {
				message: errorMsg,
				// Prevent Report Errors button for known errors
				dialogButtonText: null
			};
			Zotero.logError(errorMsg);
		}
		else {
			e = err;
			Zotero.logError(err);
		}
		
		if (!skipSuccessMessage) {
			if (!errorTitle) {
				errorTitle = Zotero.getString("general.error");
			}
			Zotero.Utilities.Internal.errorPrompt(errorTitle, e);
		}
		return false;
	},
	
	
	/**
	 * Remove files in Dropbox that were deleted locally
	 *
	 * @param {Integer} libraryID
	 */
	purgeDeletedStorageFiles: async function (libraryID) {
		var d = new Date();
		
		Zotero.debug("Purging deleted storage files");
		var files = await Zotero.Sync.Storage.Local.getDeletedFiles(libraryID);
		if (!files.length) {
			Zotero.debug("No files to delete remotely");
			return false;
		}
		
		// Add .zip extension
		files = files.map(file => file + ".zip");
		
		var results = await this._deleteStorageFiles(files);
		
		// Remove keys whose files are gone from the storage delete log
		var toPurge = Zotero.Utilities.arrayUnique(
			results.deleted.concat(results.missing)
				.filter(val => val.endsWith('.zip'))
				// Strip file extension so we just have keys
				.map(val => val.replace(/\.zip$/, ""))
		);
		if (toPurge.length > 0) {
			await Zotero.Utilities.Internal.forEachChunkAsync(
				toPurge,
				Zotero.DB.MAX_BOUND_PARAMETERS - 1,
				function (chunk) {
					return Zotero.DB.executeTransaction(async function () {
						var sql = "DELETE FROM storageDeleteLog WHERE libraryID=? AND key IN ("
							+ chunk.map(() => '?').join() + ")";
						return Zotero.DB.queryAsync(sql, [libraryID].concat(chunk));
					});
				}
			);
		}
		
		Zotero.debug(`Purged deleted storage files in ${new Date() - d} ms`);
		Zotero.debug(results);
		
		return results;
	},
	
	
	/**
	 * Delete orphaned storage files older than a week before last sync time
	 */
	purgeOrphanedStorageFiles: async function () {
		var d = new Date();
		const libraryID = Zotero.Libraries.userLibraryID;
		const library = Zotero.Libraries.get(libraryID);
		const daysBeforeSyncTime = 7;
		
		// If recently purged, skip
		var lastPurge = Zotero.Prefs.get('lastDropboxOrphanPurge');
		if (lastPurge) {
			try {
				let purgeAfter = lastPurge + (daysBeforeSyncTime * 24 * 60 * 60);
				if (new Date() < new Date(purgeAfter * 1000)) {
					return false;
				}
			}
			catch {
				Zotero.Prefs.clear('lastDropboxOrphanPurge');
			}
		}
		
		var lastSyncDate = library.lastSync;
		if (!lastSyncDate) {
			Zotero.debug(`No last sync date for library ${libraryID} -- not purging orphaned files`);
			return false;
		}
		
		Zotero.debug("Purging orphaned storage files");
		
		var entries = await this.api.listFolder(this.api.folder, this._requestOptions());
		var syncQueueKeys = new Set(
			await Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', libraryID)
		);
		var deleteFiles = [];
		for (let entry of entries) {
			if (entry['.tag'] != 'file') {
				continue;
			}
			let file = entry.name;
			if (file.startsWith('.')) {
				Zotero.debug("Skipping hidden file " + file);
				continue;
			}
			if (!file.endsWith('.zip') && !file.endsWith('.prop')) {
				Zotero.debug("Skipping file " + file);
				continue;
			}
			
			let key = file.replace(/\.(zip|prop)$/, '');
			let item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
			if (item) {
				continue;
			}
			if (syncQueueKeys.has(key)) {
				Zotero.debug(`Skipping file for item ${key} in sync queue`);
				continue;
			}
			
			// Delete files older than a week before last sync time
			let lastModified = new Date(entry.server_modified);
			let days = (lastSyncDate - lastModified) / 1000 / 60 / 60 / 24;
			if (days > daysBeforeSyncTime) {
				deleteFiles.push(file);
			}
		}
		
		var results = await this._deleteStorageFiles(deleteFiles);
		Zotero.Prefs.set("lastDropboxOrphanPurge", Math.round(new Date().getTime() / 1000));
		
		Zotero.debug(`Purged orphaned storage files in ${new Date() - d} ms`);
		Zotero.debug(results);
		
		return results;
	},
	
	
	//
	// Private methods
	//
	_requestOptions: function (options = {}) {
		return Object.assign(
			{
				errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
				errorDelayMax: this.ERROR_DELAY_MAX
			},
			options
		);
	},
	
	
	_getItemPath: function (item) {
		return this.api.folder + '/' + item.key + '.zip';
	},
	
	
	_getItemPropertyPath: function (item) {
		return this.api.folder + '/' + item.key + '.prop';
	},
	
	
	/**
	 * Get mod time and hash of file in Dropbox
	 *
	 * @param {Zotero.Item} item
	 * @param {Zotero.Sync.Storage.Request} request
	 * @return {Promise<Object|false>} - Object with 'mtime' and 'md5', or false if not found
	 */
	_getStorageFileMetadata: async function (item, request) {
		var text;
		try {
			text = await this.api.downloadText(
				this._getItemPropertyPath(item),
				this._requestOptions({
					requestObserver: xmlhttp => request.setChannel(xmlhttp.channel)
				})
			);
		}
		catch (e) {
			if (e instanceof this.api.APIError && e.is('path/not_found')) {
				return false;
			}
			throw this._getUserError(e);
		}
		
		// No metadata set
		if (!text) {
			return false;
		}
		
		var mtime = false;
		var md5 = false;
		var seconds = false;
		try {
			let xml = new DOMParser().parseFromString(text, "text/xml");
			let mtimeNode = xml.getElementsByTagName('mtime')[0];
			let hashNode = xml.getElementsByTagName('hash')[0];
			if (mtimeNode) {
				mtime = mtimeNode.textContent;
			}
			if (hashNode) {
				md5 = hashNode.textContent;
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
		
		// Accept old non-XML prop files with just mtimes in seconds, as WebDAV does, in case
		// files were copied from a WebDAV server
		if (!mtime) {
			mtime = text.trim();
			seconds = true;
		}
		
		var invalid = false;
		if (seconds) {
			if (/^[0-9]{1,10}$/.test(mtime)) {
				mtime *= 1000;
			}
			else {
				invalid = true;
			}
		}
		else if (!/^[0-9]{1,13}$/.test(mtime)) {
			invalid = true;
		}
		
		// Delete invalid .prop files
		if (invalid) {
			Zotero.logError("Invalid mod date '" + Zotero.Utilities.ellipsize(String(mtime), 20)
				+ "' for item " + item.libraryKey);
			await this._deleteStorageFiles([item.key + ".prop"]).catch(e => Zotero.logError(e));
			throw new Error(this.defaultError);
		}
		
		return {
			mtime: parseInt(mtime),
			md5
		};
	},
	
	
	/**
	 * Set mod time and hash of file in Dropbox
	 *
	 * @param {Zotero.Item} item
	 */
	_setStorageFileMetadata: async function (item) {
		var mtime = await item.attachmentModificationTime;
		var md5 = await item.attachmentHash;
		
		var xmlstr = '<properties version="1">'
			+ '<mtime>' + mtime + '</mtime>'
			+ '<hash>' + md5 + '</hash>'
			+ '</properties>';
		
		try {
			await this.api.upload(
				this._getItemPropertyPath(item),
				new TextEncoder().encode(xmlstr),
				this._requestOptions()
			);
		}
		catch (e) {
			throw this._getUserError(e);
		}
	},
	
	
	_onUploadComplete: async function (request, item, params) {
		Zotero.debug("Upload of attachment " + item.key + " to Dropbox finished");
		
		// Update .prop file in Dropbox
		await this._setStorageFileMetadata(item);
		
		item.attachmentSyncedModificationTime = params.mtime;
		item.attachmentSyncedHash = params.md5;
		item.attachmentSyncState = "in_sync";
		await item.saveTx({ skipAll: true });
		// skipAll doesn't mark as unsynced, so do that separately
		await item.updateSynced(false);
		
		try {
			await IOUtils.remove(
				PathUtils.join(Zotero.getTempDirectory().path, item.key + '.zip'),
				{ ignoreAbsent: true }
			);
		}
		catch (e) {
			Zotero.logError(e);
		}
		
		return new Zotero.Sync.Storage.Result({
			localChanges: true,
			remoteChanges: true,
			syncRequired: true
		});
	},
	
	
	/**
	 * @param {String[]} files - Filenames of files to delete
	 * @return {Promise<Object>} - Object with properties 'deleted', 'missing', and 'error', each
	 *     containing filenames
	 */
	_deleteStorageFiles: async function (files) {
		var results = {
			deleted: new Set(),
			missing: new Set(),
			error: new Set()
		};
		
		if (files.length == 0) {
			return { deleted: [], missing: [], error: [] };
		}
		
		// Delete .prop files first, as for WebDAV
		var fileNames = [];
		for (let file of files) {
			if (file.endsWith('.zip')) {
				fileNames.push(file.replace(/\.zip$/, '.prop'));
			}
			fileNames.push(file);
		}
		fileNames = Zotero.Utilities.arrayUnique(fileNames);
		fileNames.sort((a, b) => {
			return (a.endsWith('.prop') ? 0 : 1) - (b.endsWith('.prop') ? 0 : 1);
		});
		
		var funcs = fileNames.map(fileName => async () => {
			try {
				let deleted = await this.api.delete(
					this.api.folder + '/' + fileName,
					this._requestOptions()
				);
				(deleted ? results.deleted : results.missing).add(fileName);
			}
			catch (e) {
				results.error.add(fileName);
				throw e;
			}
		});
		
		// Writes to a Dropbox are serialized, so concurrent deletes mostly just conflict
		const { ConcurrentCaller } = ChromeUtils.importESModule("resource://zotero/concurrentCaller.mjs");
		var caller = new ConcurrentCaller({
			numConcurrent: 2,
			stopOnError: true,
			logger: msg => Zotero.debug(msg),
			onError: e => Zotero.logError(e)
		});
		await caller.start(funcs);
		
		// Convert sets back to arrays
		for (let i in results) {
			results[i] = Array.from(results[i]);
		}
		return results;
	},
	
	
	/**
	 * Convert API and HTTP errors into errors with a message for the user
	 */
	_getUserError: function (e) {
		if (e.dropboxError) {
			return e;
		}
		var message;
		if (e instanceof this.api.APIError) {
			if (e.summary.includes('insufficient_space')) {
				message = Zotero.ftl.formatValueSync('sync-storage-dropbox-error-insufficient-space');
			}
			else {
				message = Zotero.ftl.formatValueSync(
					'sync-storage-dropbox-error-api', { error: e.summary }
				);
			}
		}
		else if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
			if (!e.status) {
				message = Zotero.getString(
					'sync.storage.error.serverCouldNotBeReached', 'dropboxapi.com'
				);
			}
			else {
				message = Zotero.ftl.formatValueSync(
					'sync-storage-dropbox-error-http', { status: e.status }
				);
			}
		}
		else {
			return e;
		}
		Zotero.logError(e);
		return new Zotero.Error(message, 0, { dialogButtonText: null });
	}
};


/**
 * Receives the redirect from Dropbox after the user allows access in the browser
 *
 * The request is accepted from web content, but it does nothing unless its state matches an
 * authorization started from the settings, and the code it carries is useless without the
 * verifier held by this client.
 */
Zotero.Sync.Storage.Dropbox.RedirectEndpoint = function () {};
Zotero.Sync.Storage.Dropbox.RedirectEndpoint.prototype = {
	supportedMethods: ["GET"],
	allowRequestsFromUnsafeWebContent: true,
	
	init: function (req) {
		var success = Zotero.Sync.Storage.Dropbox.handleRedirect(req.searchParams);
		var prefix = 'sync-storage-dropbox-redirect-' + (success ? 'success' : 'failure');
		var title = Zotero.Utilities.htmlSpecialChars(Zotero.ftl.formatValueSync(prefix + '-title'));
		var message = Zotero.Utilities.htmlSpecialChars(Zotero.ftl.formatValueSync(prefix));
		var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
			+ `<title>${title}</title>`
			+ '<style>body{font:16px/1.5 system-ui,sans-serif;margin:15vh auto;max-width:32em;'
			+ 'padding:0 1.5em;color:#222;background:#fff}h1{font-size:1.3em}'
			+ '@media (prefers-color-scheme:dark){body{color:#eee;background:#1f1f1f}}</style>'
			+ `</head><body><h1>${title}</h1><p>${message}</p></body></html>`;
		return [success ? 200 : 400, "text/html; charset=utf-8", html];
	}
};
Zotero.Server.Endpoints[Zotero.Sync.Storage.Dropbox.REDIRECT_PATH] = Zotero.Sync.Storage.Dropbox.RedirectEndpoint;
