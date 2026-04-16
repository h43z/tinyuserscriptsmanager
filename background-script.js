(async _=> {
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
      cached.push(encodeURI(await userScript.text()))
    }

    cache.push(cached)
  }

  console.log(`The cache (precombiled regex, fetched and encoded user scripts) is`, cache)

  browser.webNavigation.onCommitted.addListener(async (details) => {
    // ignore iframes
    if (details.frameId !== 0) return

    for (const cached of cache){
      if (!cached[0].test(details.url)) continue

      console.log(`The URL ${details.url} matched regex ${cached[0]}`)

      for (let i = 1; i < cached.length; i++) {
        const userScript = cached[i]
        // To get a userscript into the context of a webpage we have to go
        // through a contentscript. A injected contentscript can then inject
        // a script tag which loads the userscript.
        // Converting the userScript into any kind of URL (here data URL)
        // allows us to bypass all Content Security Policies of a page ecxept
        // the sandbox directive.
        const contentScript =  `
          {
            function injectUserScript(){
              const userScript = document.createElement("script");
              userScript.src = "data:text/javascript,${userScript}";
              userScript.async = true; /* don't block parsing of HTML during "download" */
              document.documentElement.prepend(userScript);
            }

            if(document.documentElement){
              // minimal DOM is already there inject right away
              injectUserScript()
            }else{
              // wait for document.documentElement to appear in the DOM
              // to inject userscript as early as possible
              const observer = new MutationObserver(function () {
                if(document.documentElement) {
                  observer.disconnect();
                  injectUserScript();
                }
              });
              observer.observe(document, {
                childList: true,
                subtree: true
              });
            }
          }
         `

        console.log(`injecting a cached user script`,
          userScript.length > 25 ? userScript.slice(0, 22) + "..." : userScript)

        browser.tabs.executeScript(details.tabId, {
          code: contentScript,
          runAt: "document_start"
        })
      }
    }
  })
})()

