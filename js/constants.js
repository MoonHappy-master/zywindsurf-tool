/**
 * 全局常量配置
 */
const CONSTANTS = {
  // Firebase API Key
  FIREBASE_API_KEY: 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY',
  
  // Windsurf 注册 API
  WINDSURF_REGISTER_API: 'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser',
  
  // 请求超时时间 (ms)
  REQUEST_TIMEOUT: 30000,
  
  // 本地代理配置（通过系统设置页面配置）
  // 设为 null 禁用代理
  PROXY: null
};

module.exports = CONSTANTS;
