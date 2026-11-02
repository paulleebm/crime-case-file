export function phoneCallAsLastMeeting(text: string): boolean {
  const compact = text.replace(/\s/g, '').replace(/여덟시/g, '8시').replace(/이십오분/g, '25분').replace(/이십육분/g, '26분');
  const time = /20:2[56]|8시2[56]분/.test(compact);
  const meeting = /직접(?:말(?:을)?나눈|대화|만[난나]|뵌|본)/.test(compact);
  const last = /마지막|뿐/.test(compact);
  const correction = /잘못|철회|마지막(?:이|은|으로)?아니|30분.*(?:뵀|뵙|만났|대화)/.test(compact);
  return time && meeting && last && !correction;
}
