export type TaskType = 'image' | 'video';

export type FriendlyGenerationError = {
  title: string;
  reason: string;
  suggestion: string;
};

export const GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
export const GENERATION_SUBMIT_TIMEOUT_MS = GENERATION_TIMEOUT_MS;
export const GENERATION_POLL_TIMEOUT_MS = GENERATION_TIMEOUT_MS;

export function getPollingInterval(elapsedMs: number, taskType: TaskType): number {
  const isFirstMinute = elapsedMs < 60_000;
  if (taskType === 'image') {
    return isFirstMinute ? 10_000 : 30_000;
  }
  return isFirstMinute ? 5_000 : 15_000;
}

export function shouldContinuePolling(elapsedMs: number, taskType: TaskType): boolean {
  void taskType;
  return elapsedMs < GENERATION_POLL_TIMEOUT_MS;
}

export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  const transientKeywords = [
    'socket',
    'network',
    'fetch',
    'timeout',
    'econnreset',
    'etimedout',
    'connection',
    'server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'status: 5',
    'invalid response',
    'unexpected token',
    'json',
    'missing video payload',
    'missing image payload',
    'missing content',
    'payload missing',
    'request failed: 400',
    'status: 400',
    'generation process begins',
    'still processing',
    'heavy_load',
    'heavy load',
    'under heavy load',
    'try again later',
    'please try again',
  ];

  return transientKeywords.some((keyword) => lowerMessage.includes(keyword));
}

export function getFriendlyErrorMessage(errMsg: string): string {
  const copy = getGenerationErrorCopy(errMsg);
  return `${copy.reason} ${copy.suggestion}`;
}

export function formatGenerationError(copy: FriendlyGenerationError): string {
  return `${copy.title}\n${copy.reason}\n${copy.suggestion}`;
}

export function getGenerationErrorCopy(error: unknown): FriendlyGenerationError {
  const errMsg = error instanceof Error ? error.message : String(error || '');
  const lowerMsg = errMsg.toLowerCase();
  const normalized = errMsg.trim();

  if (normalized.includes('积分不足') || lowerMsg.includes('insufficient balance')) {
    const points = normalized.match(/at least\s+(\d+)\s+points/i)?.[1];
    return {
      title: '积分不足',
      reason: points ? `这次生成至少需要 ${points} 积分，当前余额不够。` : '当前积分余额不够完成这次生成。',
      suggestion: '请先充值积分，或选择消耗更低的模型后再试。',
    };
  }

  if (
    normalized.includes('提交太频繁') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('rate limit')
  ) {
    return {
      title: '提交太频繁',
      reason: '短时间内提交的生成任务太多，系统暂时限制了新的请求。',
      suggestion: '请稍等一会儿再提交，批量任务可以分几次开始。',
    };
  }

  if (
    normalized.includes('请选择模型') ||
    normalized.includes('选择模型') ||
    lowerMsg.includes('failed to load models') ||
    lowerMsg.includes('missing model id') ||
    lowerMsg.includes('model not found')
  ) {
    return {
      title: lowerMsg.includes('failed to load models') ? '模型列表加载失败' : '模型不可用',
      reason: lowerMsg.includes('failed to load models')
        ? '页面暂时没有拿到可用模型列表。'
        : '没有找到当前选择的模型，可能是模型已被关闭或配置发生了变化。',
      suggestion: lowerMsg.includes('failed to load models')
        ? '请刷新页面再试；如果仍然加载失败，请联系管理员检查模型配置。'
        : '请重新选择一个可用模型后再试。',
    };
  }

  if (normalized.includes('模型已停用') || lowerMsg.includes('model is disabled')) {
    return {
      title: '模型已停用',
      reason: '当前选择的模型暂时不能使用。',
      suggestion: '请换一个模型再提交任务。',
    };
  }

  if (
    normalized.includes('缺少提示词') ||
    normalized.includes('缺少参考图') ||
    normalized.includes('提示词或参考图') ||
    normalized.includes('上传参考图') ||
    normalized.includes('没有可提交') ||
    lowerMsg.includes('requires a reference image') ||
    lowerMsg.includes('requires reference image') ||
    lowerMsg.includes('please enter a prompt or upload a reference image') ||
    lowerMsg.includes('missing image input')
  ) {
    return {
      title: '缺少必要内容',
      reason: '当前模型需要提示词或参考图，但任务里还没有填写完整。',
      suggestion: '请补充提示词，或上传参考图后再开始生成。',
    };
  }

  if (
    normalized.includes('图片太大') ||
    normalized.includes('图片大小') ||
    lowerMsg.includes('image size must be') ||
    lowerMsg.includes('too large') ||
    lowerMsg.includes('payload too large') ||
    lowerMsg.includes('413')
  ) {
    return {
      title: '图片太大',
      reason: '上传的参考图文件过大，可能无法稳定传输。',
      suggestion: '请压缩图片，或换一张体积更小的图片后再试。',
    };
  }

  if (
    lowerMsg.includes('invalid response') ||
    lowerMsg.includes('unexpected token') ||
    lowerMsg.includes('json') ||
    lowerMsg.includes('missing content') ||
    lowerMsg.includes('payload missing')
  ) {
    return {
      title: '结果返回异常',
      reason: '服务端返回的内容不完整，页面暂时无法读取生成结果。',
      suggestion: '请稍后刷新历史记录查看结果；如果没有结果，再重新提交一次。',
    };
  }

  if (
    normalized.includes('任务查询超时') ||
    lowerMsg.includes('generation process begins') ||
    lowerMsg.includes('missing video payload') ||
    lowerMsg.includes('missing image payload')
  ) {
    return {
      title: '任务还在处理中',
      reason: '生成服务已经开始处理，但这次返回结果比较慢。',
      suggestion: '请稍等一会儿，或到历史记录里查看最终结果。',
    };
  }

  if (
    normalized.includes('生成服务繁忙') ||
    lowerMsg.includes('heavy_load') ||
    lowerMsg.includes('heavy load') ||
    lowerMsg.includes('try again later') ||
    lowerMsg.includes('service unavailable') ||
    lowerMsg.includes('bad gateway') ||
    lowerMsg.includes('gateway timeout') ||
    lowerMsg.includes('server error') ||
    lowerMsg.includes('status: 5')
  ) {
    return {
      title: '生成服务繁忙',
      reason: '当前生成服务压力较大，任务没有顺利完成。',
      suggestion: '请稍后重试；批量生图建议减少同时提交的任务数量。',
    };
  }

  if (
    normalized.includes('网络不稳定') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('socket') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('connection') ||
    lowerMsg.includes('fetch') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout')
  ) {
    return {
      title: '网络不稳定',
      reason: '页面和生成服务之间的连接中断或等待时间过长。',
      suggestion: '请检查网络后重试；如果任务已提交，可以先到历史记录查看是否生成成功。',
    };
  }

  if (lowerMsg.includes('status: 400') || lowerMsg.includes('request failed: 400')) {
    return {
      title: '请求内容有问题',
      reason: '这次提交的参数没有被生成服务接受。',
      suggestion: '请检查提示词、模型、比例和参考图后重新提交。',
    };
  }

  if (lowerMsg.includes('unauthorized') || lowerMsg.includes('please login') || lowerMsg.includes('401')) {
    return {
      title: '登录状态失效',
      reason: '当前登录状态可能已经过期。',
      suggestion: '请刷新页面或重新登录后再试。',
    };
  }

  if (lowerMsg.includes('forbidden') || lowerMsg.includes('403')) {
    return {
      title: '没有操作权限',
      reason: '当前账号不能执行这次操作。',
      suggestion: '请确认账号状态，或联系管理员检查权限。',
    };
  }

  if (normalized.includes('剩余') && normalized.includes('次数不足')) {
    return {
      title: '今日次数不够',
      reason: normalized,
      suggestion: '请减少本次提交的任务数量，或明天再继续生成。',
    };
  }

  if (
    normalized.includes('今日') &&
    (normalized.includes('达到上限') || normalized.includes('已达上限'))
  ) {
    return {
      title: '今日次数已用完',
      reason: '今天的图像生成次数已经达到上限。',
      suggestion: '请明天再试，或联系管理员调整每日生成次数。',
    };
  }

  if (normalized) {
    return {
      title: '生成失败',
      reason: '这次生成没有成功完成。',
      suggestion: '请稍后重试；如果多次失败，可以更换模型、简化提示词或减少参考图数量。',
    };
  }

  return {
    title: '生成失败',
    reason: '这次生成没有成功完成。',
    suggestion: '请稍后重试，或换一个模型再试。',
  };
}

export function getLegacyFriendlyErrorMessage(errMsg: string): string {
  const lowerMsg = errMsg.toLowerCase();
  if (
    lowerMsg.includes('generation process begins') ||
    lowerMsg.includes('missing video payload') ||
    lowerMsg.includes('missing image payload')
  ) {
    return 'Server timeout. Please try again later.';
  }
  if (
    lowerMsg.includes('heavy_load') ||
    lowerMsg.includes('heavy load') ||
    lowerMsg.includes('try again later')
  ) {
    return 'Server is busy. Please try again later.';
  }
  if (lowerMsg.includes('status: 400') || lowerMsg.includes('request failed: 400')) {
    return 'Request failed. Please retry.';
  }
  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('socket') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('connection')
  ) {
    return 'Network error. Please check your connection.';
  }
  return errMsg;
}
