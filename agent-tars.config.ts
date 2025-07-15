// OpenRouter 설정으로 Agent TARS 실행
export default {
  // OpenRouter 모델 설정
  model: {
    provider: 'openrouter',
    id: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
  },

  // 브라우저 설정 - 로컬 프로필 사용
  browser: {
    control: 'mixed',
    headless: false,
    useLocalProfile: true, // 🎯 로컬 Chrome 프로필 사용
  },

  logLevel: 'info',
};
