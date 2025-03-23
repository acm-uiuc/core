export function pollUntilNoError<T>(
  fn: () => Promise<T>,
  timeout: number,
  interval: number = 1000
): Promise<T> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const result = await fn();
        return resolve(result);
      } catch (err) {
        if (Date.now() - start >= timeout) return reject(err);
        setTimeout(attempt, interval);
      }
    };
    attempt();
  });
}
