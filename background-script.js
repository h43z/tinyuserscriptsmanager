const cache = []

async function main(){
  let { configUrl } = await browser.storage.local.get('configUrl')

  if(!configUrl){
    configUrl = `data:,{".*":["data:,console.log('tiny user script injected into all sites 😀')"]}`
    await browser.storage.local.set({configUrl})
  }

  console.log(`The config url is ${configUrl}`)

  const config = await (await fetch(configUrl)).json()
  console.log(`The fetched config is`, config)

  const urlMatches = []
  for (const pattern in config){
    // Pre create the regex object to safe a little time later
    const regex = new RegExp(pattern)
    const cached = [regex]

    // Store patterns to pass them later filter to
    // browser.webNavigation.onCommitted,
    // this way the listener only runs if really necessary, though having a
    // config with a userscript that is injected into ALL websites makes the 
    // filter effectively useless
    urlMatches.push({ urlMatches: pattern})

    // Fetch the individual userscripts sequentially
    for (const userScriptURL of config[pattern]){
      const userScript = await fetch(userScriptURL)
      cached.push(encodeURI(await userScript.text()))
    }

    cache.push(cached)
  }

  console.log(`The cache (precombiled regex, fetched and encoded user scripts) is`, cache)

  browser.webNavigation.onCommitted.addListener(onCommitListener, {
    url: urlMatches
  })
}

async function onCommitListener(details){
  // Ignore iframes
  if (details.frameId !== 0) return

  console.log('One of WebNavigation URL filter matched, need to check which one')

  for (const cached of cache){
    if (!cached[0].test(details.url)) continue

    console.log(`The URL ${details.url} matched regex ${cached[0]}`)

    for (let i = 1; i < cached.length; i++) {
      const userScript = cached[i]
      // To get a userscript into the context of a webpage we have to go
      // through a contentscript. A injected contentscript can then inject
      // a script tag which loads the userscript.
      // Converting the userScript into any kind of URL (here data URL)
      // allows us to bypass all Content Security Policies of a page except
      // if it hs the sandbox directive.
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
}

main()
