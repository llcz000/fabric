export async function withSmokeProcessLifecycle(options) {
  let tempDir;
  let setupValue;
  let child;
  let detachChildError = () => {};

  try {
    tempDir = await options.createTempDir();
    setupValue = await options.setup(tempDir);
    child = options.spawnChild({ tempDir, setup: setupValue });

    const childError = new Promise((_, reject) => {
      const onError = (error) => reject(error);
      child.once('error', onError);
      detachChildError = () => child.off('error', onError);
    });
    const running = Promise.resolve().then(() => options.run({ tempDir, setup: setupValue, child }));
    return await Promise.race([running, childError]);
  } finally {
    try {
      if (child) await options.stopChild(child);
    } finally {
      detachChildError();
      if (tempDir !== undefined) await options.removeTempDir(tempDir);
    }
  }
}
