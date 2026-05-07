/**
 * 账号登录获取 Token 模块
 * 通过 Electron 内置浏览器访问 windsurf.com 登录页面
 * 利用页面自身的 Firebase App Check 机制完成认证
 */

const axios = require('axios');
const { BrowserWindow, session } = require('electron');
const CONSTANTS = require('./constants');

class AccountLogin {
  constructor() {
    this.logCallback = null;
  }

  /**
   * 输出日志
   */
  log(message) {
    console.log(message);
    if (this.logCallback) {
      this.logCallback(message);
    }
  }

  /**
   * 通过 Electron 内置浏览器登录 windsurf.com 获取 Firebase Token
   */
  async loginWithEmailPassword(email, password) {
    // 独立 session，互不干扰
    const partition = `login-${Date.now()}`;
    const ses = session.fromPartition(partition);

    // 代理可选
    if (CONSTANTS.PROXY) {
      const proxyUrl = `${CONSTANTS.PROXY.protocol}://${CONSTANTS.PROXY.host}:${CONSTANTS.PROXY.port}`;
      this.log(`使用代理: ${proxyUrl}`);
      await ses.setProxy({ proxyRules: proxyUrl });
    } else {
      this.log('未配置代理，直连访问');
    }

    const win = new BrowserWindow({
      show: true,
      width: 1024,
      height: 720,
      title: '登录 Windsurf',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: partition
      }
    });

    try {
      const result = await this._performLogin(win, email, password);
      await this._sleep(1000);
      try { win.close(); } catch (e) { /* ignore */ }
      return result;
    } catch (error) {
      this.log('登录失败，请查看浏览器窗口，10秒后自动关闭...');
      await this._sleep(10000);
      try { win.close(); } catch (e) { /* ignore */ }
      throw error;
    }
  }

  /**
   * 执行登录流程
   */
  async _performLogin(win, email, password) {
    // 用 Electron webRequest API 捕获真实 HTTP 请求 headers（只读，不阻塞请求）
    // 按 endpoint 类型分别捕获，因为不同 endpoint 用不同的 auth header
    var capturedHeadersByEndpoint = {}; // { endpointName: headers }
    var ses = win.webContents.session;
    ses.webRequest.onSendHeaders({ urls: ['*://*.windsurf.com/*'] }, (details) => {
      if (details.url.indexOf('_backend') !== -1) {
        // 提取 endpoint 名（最后一段）
        var parts = details.url.split('/');
        var endpoint = parts[parts.length - 1];
        // 每个 endpoint 只捕获一次
        if (!capturedHeadersByEndpoint[endpoint]) {
          capturedHeadersByEndpoint[endpoint] = Object.assign({}, details.requestHeaders);
        }
      }
    });

    // 加载登录页
    this.log('正在加载登录页面...');
    await win.loadURL('https://windsurf.com/account/login');
    this.log('登录页面已加载，等待渲染...');
    await this._sleep(3000);

    // 注入 fetch 拦截器（捕获关键 API 响应）
    await this._execJS(win, `
      localStorage.removeItem('__captured_auth_response');
      localStorage.removeItem('__captured_post_auth');
      localStorage.removeItem('__captured_register');
      (function() {
        var origFetch = window.fetch;
        window.fetch = function() {
          var url = (typeof arguments[0] === 'string') ? arguments[0] : (arguments[0].url || '');
          // 拦截关键 API 响应
          var isAuthLogin = url.indexOf('password/login') !== -1;
          var isPostAuth = url.indexOf('WindsurfPostAuth') !== -1;
          var isRegister = url.indexOf('RegisterUser') !== -1;
          if (isAuthLogin || isPostAuth || isRegister) {
            return origFetch.apply(this, arguments).then(function(resp) {
              var clone = resp.clone();
              clone.text().then(function(text) {
                if (isAuthLogin) localStorage.setItem('__captured_auth_response', text);
                if (isPostAuth) localStorage.setItem('__captured_post_auth', text);
                if (isRegister) localStorage.setItem('__captured_register', text);
              }).catch(function(){});
              return resp;
            });
          }
          return origFetch.apply(this, arguments);
        };
      })();
    `);
    this.log('已注入 fetch 拦截器');

    // 第一步：填写邮箱
    this.log('正在填写邮箱...');
    await this._execJS(win, `
      var inp = document.querySelector('input[placeholder*="example"]')
             || document.querySelector('input[type="email"]')
             || document.querySelector('input[name="email"]')
             || document.querySelectorAll('input')[0];
      if (inp) {
        inp.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '');
        inp.dispatchEvent(new Event('input', {bubbles:true}));
      }
    `);
    // 逐字输入邮箱，模拟真人
    for (const ch of email) {
      await this._execJS(win, `
        var inp = document.querySelector('input[placeholder*="example"]')
               || document.querySelector('input[type="email"]')
               || document.querySelector('input[name="email"]')
               || document.querySelectorAll('input')[0];
        if (inp) {
          var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(inp, inp.value + '${ch.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');
          inp.dispatchEvent(new Event('input', {bubbles:true}));
        }
      `);
      await this._sleep(20);
    }
    this.log('邮箱已填写');

    // 点击 Continue
    await this._sleep(500);
    await this._execJS(win, `
      var btns = document.querySelectorAll('button');
      var clicked = false;
      for (var b of btns) {
        if (b.textContent.includes('Continue')) { b.click(); clicked = true; break; }
      }
      if (!clicked) {
        var sub = document.querySelector('button[type="submit"]');
        if (sub) sub.click();
      }
    `);
    this.log('已点击 Continue，等待密码输入框...');

    // 等待密码框出现
    var found = false;
    for (var i = 0; i < 20; i++) {
      await this._sleep(1000);
      found = await this._execJS(win, `!!document.querySelector('input[type="password"]')`);
      if (found) break;
    }
    if (!found) {
      var info = await this._execJS(win, `document.title + ' | ' + location.href`);
      this.log('页面状态: ' + info);
      throw new Error('等待密码输入框超时');
    }
    this.log('密码输入框已出现');

    // 第二步：填写密码
    await this._sleep(500);
    await this._execJS(win, `
      var inp = document.querySelector('input[type="password"]');
      if (inp) {
        inp.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '');
        inp.dispatchEvent(new Event('input', {bubbles:true}));
      }
    `);
    for (const ch of password) {
      await this._execJS(win, `
        var inp = document.querySelector('input[type="password"]');
        if (inp) {
          var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(inp, inp.value + '${ch.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');
          inp.dispatchEvent(new Event('input', {bubbles:true}));
        }
      `);
      await this._sleep(20);
    }
    this.log('密码已填写');

    // 点击登录
    await this._sleep(500);
    await this._execJS(win, `
      var btns = document.querySelectorAll('button');
      var clicked = false;
      for (var b of btns) {
        var t = b.textContent.toLowerCase();
        if (t.includes('sign in') || t.includes('log in') || t.includes('continue') || t.includes('登录')) {
          b.click(); clicked = true; break;
        }
      }
      if (!clicked) {
        var sub = document.querySelector('button[type="submit"]');
        if (sub) sub.click();
      }
    `);
    this.log('已提交登录，等待页面跳转...');

    // 等待页面跳转（离开登录页 = 登录成功）
    var loggedIn = false;
    for (var i = 0; i < 60; i++) {
      await this._sleep(1000);
      var currentUrl = win.webContents.getURL();
      if (!currentUrl.includes('/account/login')) {
        loggedIn = true;
        this.log('登录成功，页面已跳转: ' + currentUrl);
        break;
      }
      // 每10秒打印一次状态
      if (i > 0 && i % 10 === 0) {
        var title = await this._execJS(win, 'document.title');
        this.log('等待中... (' + i + '秒) URL: ' + currentUrl + ' Title: ' + title);
      }
    }

    if (!loggedIn) {
      throw new Error('登录超时（60秒），页面未跳转，请检查账号密码');
    }

    // 等待 profile 页面完全加载（页面会自动调用 _backend API，webRequest 会捕获 headers）
    await this._sleep(5000);

    this.log('正在提取认证信息...');

    var capturedEndpoints = Object.keys(capturedHeadersByEndpoint);
    if (capturedEndpoints.length === 0) {
      this.log('尚未捕获到 _backend 请求，再等 5 秒...');
      await this._sleep(5000);
      capturedEndpoints = Object.keys(capturedHeadersByEndpoint);
    }
    this.log('已捕获 ' + capturedEndpoints.length + ' 个 endpoint');

    // 打印每个登录后 endpoint 的 auth 相关 headers，看清楚每个用什么认证
    var loginPostEndpoints = ['GetCurrentUser', 'GetUsers', 'GetTeamBilling', 'GetPlanStatus', 'WindsurfPostAuth'];
    for (var en of loginPostEndpoints) {
      if (capturedHeadersByEndpoint[en]) {
        var hs = capturedHeadersByEndpoint[en];
        var authOnly = {};
        for (var k of Object.keys(hs)) {
          var lk2 = k.toLowerCase();
          if (lk2.indexOf('auth') !== -1 || lk2.indexOf('token') !== -1 || lk2.indexOf('session') !== -1 ||
              lk2 === 'cookie' || lk2 === 'authorization' || lk2.startsWith('x-')) {
            authOnly[k] = (hs[k] || '').substring(0, 80);
          }
        }
        this.log('[' + en + '] auth headers: ' + JSON.stringify(authOnly));
      }
    }

    // 优先用 GetCurrentUser 的 headers（这是登录后用户信息接口的真实认证）
    var sessionAuthHeaders = capturedHeadersByEndpoint['GetCurrentUser']
                          || capturedHeadersByEndpoint['GetUsers']
                          || capturedHeadersByEndpoint['GetPlanStatus'];

    // 清理 webRequest listener
    ses.webRequest.onSendHeaders(null);

    if (!sessionAuthHeaders) {
      throw new Error('未捕获到登录后的认证 headers');
    }

    // 提取认证相关的 headers（仅 x-* / auth / token / session / cookie 类）
    var authHeaders = {};
    for (var hk of Object.keys(sessionAuthHeaders)) {
      var lhk = hk.toLowerCase();
      if (lhk.startsWith('x-') || lhk === 'authorization' || lhk === 'cookie' ||
          lhk.indexOf('auth') !== -1 || lhk.indexOf('token') !== -1 || lhk.indexOf('session') !== -1 ||
          lhk === 'connect-protocol-version') {
        authHeaders[hk] = sessionAuthHeaders[hk];
      }
    }
    this.log('使用的 auth headers: ' + JSON.stringify(authHeaders));

    // 提取 localStorage token
    var sessionToken = await this._execJS(win, `
      (function() { var r = localStorage.getItem('devin_session_token') || ''; try { return JSON.parse(r); } catch(e) { return r; } })();
    `);
    var auth1Token = await this._execJS(win, `
      (function() { var r = localStorage.getItem('devin_auth1_token') || ''; try { return JSON.parse(r); } catch(e) { return r; } })();
    `);

    // 候选 API 列表
    var endpoints = [
      'exa.seat_management_pb.SeatManagementService/GetCurrentUser',
      'exa.seat_management_pb.SeatManagementService/RegisterUser',
      'exa.seat_management_pb.SeatManagementService/WindsurfPostAuth'
    ];

    var foundApiKey = null;
    var foundName = '';
    var foundApiServerUrl = '';
    var headersToSend = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);

    for (var ep of endpoints) {
      this.log('尝试调用: ' + ep.split('/').pop());
      var resp = await this._execJS(win, `
        (function() {
          var headers = ${JSON.stringify(headersToSend)};
          return fetch('/_backend/${ep}', {
            method: 'POST',
            headers: headers,
            body: '{}'
          }).then(function(r) {
            return r.text().then(function(t) { return r.status + '|' + t; });
          }).catch(function(e) { return 'ERROR:' + e.message; });
        })();
      `);

      this.log('响应: ' + (resp || '').substring(0, 1500));

      if (resp && !resp.startsWith('ERROR:')) {
        var pipeIdx = resp.indexOf('|');
        var statusCode = resp.substring(0, pipeIdx);
        var body = resp.substring(pipeIdx + 1);

        if (statusCode === '200') {
          try {
            var data = JSON.parse(body);
            var apiKey = this._findApiKey(data);
            if (apiKey) {
              foundApiKey = apiKey;
              foundName = data.name || data.first_name || (data.user && (data.user.name || data.user.first_name)) || '';
              foundApiServerUrl = data.api_server_url || data.apiServerUrl || '';
              this.log('✓ 在 ' + ep.split('/').pop() + ' 中找到 API Key!');
              break;
            }
          } catch(e) {
            // 不是 JSON
          }
        }
      }
    }

    if (foundApiKey) {
      return {
        idToken: sessionToken,
        refreshToken: auth1Token || sessionToken,
        email: email,
        expiresIn: 3600,
        localId: '',
        apiKey: foundApiKey,
        name: foundName,
        apiServerUrl: foundApiServerUrl
      };
    }

    throw new Error('无法在任何端点找到 API Key');
  }

  /**
   * 安全执行 JS（返回原始值，不返回 DOM 对象）
   */
  async _execJS(win, code) {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (e) {
      this.log(`JS执行异常: ${e.message}`);
      return null;
    }
  }

  /**
   * 递归查找对象中的 api_key 字段
   */
  _findApiKey(obj, depth) {
    depth = depth || 0;
    if (depth > 5 || !obj || typeof obj !== 'object') return null;
    for (var key of Object.keys(obj)) {
      var val = obj[key];
      var lk = key.toLowerCase();
      if ((lk === 'api_key' || lk === 'apikey') && typeof val === 'string' && val.length > 20) {
        return val;
      }
      if (typeof val === 'object' && val !== null) {
        var found = this._findApiKey(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * 将 Firebase 错误消息转为友好提示
   */
  _friendlyError(msg) {
    const map = {
      'EMAIL_NOT_FOUND': '邮箱不存在',
      'INVALID_PASSWORD': '密码错误',
      'INVALID_LOGIN_CREDENTIALS': '邮箱或密码错误',
      'USER_DISABLED': '账号已被禁用',
      'TOO_MANY_ATTEMPTS_TRY_LATER': '尝试次数过多，请稍后再试',
      'INVALID_EMAIL': '邮箱格式不正确'
    };
    for (const [key, val] of Object.entries(map)) {
      if (msg.includes(key)) return val;
    }
    return msg;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 使用邮箱密码获取完整的账号信息
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   * @returns {Promise<Object>} - 返回完整的账号信息
   */
  async getAccountInfoByPassword(email, password) {
    try {
      const loginResult = await this.loginWithEmailPassword(email, password);
      
      // 如果浏览器登录已经直接返回了 apiKey，跳过单独的 getApiKey 调用
      let apiKey, name, apiServerUrl;
      if (loginResult.apiKey) {
        apiKey = loginResult.apiKey;
        name = loginResult.name || '';
        apiServerUrl = loginResult.apiServerUrl || '';
        this.log('使用浏览器登录返回的 API Key');
      } else {
        const apiKeyInfo = await this.getApiKey(loginResult.idToken);
        apiKey = apiKeyInfo.apiKey;
        name = apiKeyInfo.name;
        apiServerUrl = apiKeyInfo.apiServerUrl;
      }
      
      const accountInfo = {
        email: email,
        password: password,
        refreshToken: loginResult.refreshToken,
        idToken: loginResult.idToken,
        idTokenExpiresAt: Date.now() + (loginResult.expiresIn * 1000),
        apiKey: apiKey,
        name: name,
        apiServerUrl: apiServerUrl,
        createdAt: new Date().toISOString()
      };
      
      return accountInfo;
    } catch (error) {
      this.log(`获取账号信息失败`);
      this.log(`   错误: ${error.message}`);
      throw error;
    }
  }

  /**
   * 使用 access_token 获取 API Key
   */
  async getApiKey(accessToken) {
    try {
      const axiosConfig = {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      };
      if (CONSTANTS.PROXY) {
        axiosConfig.proxy = CONSTANTS.PROXY;
      }
      const response = await axios.post(
        'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser',
        {
          firebase_id_token: accessToken
        },
        axiosConfig
      );
      
      return {
        apiKey: response.data.api_key,
        name: response.data.name,
        apiServerUrl: response.data.api_server_url
      };
    } catch (error) {
      // 尝试打印代理环境变量
      const proxyEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
      if (proxyEnv) {
        this.log(`   当前环境变量代理: ${proxyEnv}`);
      } else {
        this.log(`   提示: 未检测到 Node.js 代理环境变量 (HTTPS_PROXY/HTTP_PROXY)`);
      }

      // 判断是否为网络连接问题
      if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        this.log('无法连接到服务器');
        this.log('   错误: 网络连接失败');
        this.log('   建议: 请检查网络连接');
        throw new Error('无法连接到 Windsurf 服务器，请检查网络连接');
      }
      
      const errorMessage = error.response?.data?.error?.message || error.message;
      this.log(`获取 API Key 失败: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * 登录账号并获取完整 Token（兼容旧接口）
   * @param {Object} account - 账号信息 { email, password }
   * @param {Function} logCallback - 日志回调函数
   * @returns {Object} - 包含完整 Token 信息的账号对象
   */
  async loginAndGetTokens(account, logCallback) {
    this.logCallback = logCallback;
    
    try {
      this.log('========== 开始登录获取 Token ==========');
      this.log(`账号: ${account.email}`);
      this.log('');
      
      // 使用中转服务登录
      const accountInfo = await this.getAccountInfoByPassword(account.email, account.password);
      
      this.log('');
      this.log('========== 登录完成 ==========');
      this.log('');
      
      // 返回更新后的账号信息
      return {
        success: true,
        account: {
          ...account,
          name: accountInfo.name,
          apiKey: accountInfo.apiKey,
          apiServerUrl: accountInfo.apiServerUrl,
          refreshToken: accountInfo.refreshToken,
          idToken: accountInfo.idToken,
          idTokenExpiresAt: accountInfo.idTokenExpiresAt,
          updatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      this.log('');
      this.log('========== 登录失败 ==========');
      this.log(`错误: ${error.message}`);
      this.log('');
      
      return {
        success: false,
        error: error.message,
        account: account
      };
    }
  }
}

module.exports = AccountLogin;
