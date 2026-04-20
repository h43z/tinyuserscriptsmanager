browser.webNavigation.onCommitted.addListener(onCommittedListener)

async function main(){
  const { cache } = await browser.storage.session.get('cache')
  if(!cache) buildCache()
}

async function buildCache(){
  let { configUrl } = await browser.storage.local.get('configUrl')

  if(!configUrl){
    configUrl = `data:,{".*":["data:,console.log('tiny user script injected into all sites')"]}`
    await browser.storage.local.set({configUrl})
  }

  console.log(`The config url is ${configUrl}`)

  const config = await (await fetch(configUrl)).json()
  console.log(`The fetched config is`, config)

  const cache = []
  for (const pattern in config){
    // pre create the regex object
    const regex = new RegExp(pattern)
    // store it at first index
    const cached = [regex]
    // fetch the individual userscripts sequentially
    for (const userScriptURL of config[pattern]){
      const userScript = await fetch(userScriptURL)
      cached.push(await userScript.text())
    }
    cache.push(cached)
  }

  browser.storage.session.set({cache})

  console.log(`The cache (precombiled regex, fetched and encoded user scripts) is`, cache)
}

async function onCommittedListener(details){
  // ignore iframes
  if (details.frameId !== 0) return

  const { cache } = await browser.storage.session.get('cache')

  for (const cached of cache){
    if (!cached[0].test(details.url)) continue

    console.log(`The URL ${details.url} matched regex ${cached[0]}`)

    for (let i = 1; i < cached.length; i++) {
      const userScript = cached[i]

      console.log(`injecting a cached user script`,
        userScript.length > 25 ? userScript.slice(0, 22) + "..." : userScript)

      browser.scripting.executeScript({
        injectImmediately: true,
        target: { tabId: details.tabId },
        func: userScript => {
          eval(userScript)
        },
        args:[userScript],
        world: 'MAIN'
      })
    }
  }
}

main()
