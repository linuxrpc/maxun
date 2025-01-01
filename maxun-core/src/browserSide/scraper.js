/* eslint-disable @typescript-eslint/no-unused-vars */

const area = (element) => element.offsetHeight * element.offsetWidth;

function getBiggestElement(selector) {
  const elements = Array.from(document.querySelectorAll(selector));
  const biggest = elements.reduce(
    (max, elem) => (
      area(elem) > area(max) ? elem : max),
    { offsetHeight: 0, offsetWidth: 0 },
  );
  return biggest;
}

/**
 * Generates structural selector (describing element by its DOM tree location).
 *
 * **The generated selector is not guaranteed to be unique!** (In fact, this is
 *    the desired behaviour in here.)
 * @param {HTMLElement} element Element being described.
 * @returns {string} CSS-compliant selector describing the element's location in the DOM tree.
 */
function GetSelectorStructural(element) {
  // Base conditions for the recursive approach.
  if (element.tagName === 'BODY') {
    return 'BODY';
  }
  const selector = element.tagName;
  if (element.parentElement) {
    return `${GetSelectorStructural(element.parentElement)} > ${selector}`;
  }

  return selector;
}

/**
 * Heuristic method to find collections of "interesting" items on the page.
 * @returns {Array<HTMLElement>} A collection of interesting DOM nodes
 *  (online store products, plane tickets, list items... and many more?)
 */
function scrapableHeuristics(maxCountPerPage = 50, minArea = 20000, scrolls = 3, metricType = 'size_deviation') {
  const restoreScroll = (() => {
    const { scrollX, scrollY } = window;
    return () => {
      window.scrollTo(scrollX, scrollY);
    };
  })();

  /**
* @typedef {Array<{x: number, y: number}>} Grid
*/

  /**
 * Returns an array of grid-aligned {x,y} points.
 * @param {number} [granularity=0.005] sets the number of generated points
 *  (the higher the granularity, the more points).
 * @returns {Grid} Array of {x, y} objects.
 */
  function getGrid(startX = 0, startY = 0, granularity = 0.005) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const out = [];
    for (let x = 0; x < width; x += 1 / granularity) {
      for (let y = 0; y < height; y += 1 / granularity) {
        out.push({ x: startX + x, y: startY + y });
      }
    }
    return out;
  }

  let maxSelector = { selector: 'body', metric: 0 };

  const updateMaximumWithPoint = (point) => {
    const currentElement = document.elementFromPoint(point.x, point.y);
    const selector = GetSelectorStructural(currentElement);

    const elements = Array.from(document.querySelectorAll(selector))
      .filter((element) => area(element) > minArea);

    // If the current selector targets less than three elements,
    // we consider it not interesting (would be a very underwhelming scraper)
    if (elements.length < 3) {
      return;
    }

    let metric = null;

    if (metricType === 'total_area') {
      metric = elements
        .reduce((p, x) => p + area(x), 0);
    } else if (metricType === 'size_deviation') {
      // This could use a proper "statistics" approach... but meh, so far so good!
      const sizes = elements
        .map((element) => area(element));

      metric = (1 - (Math.max(...sizes) - Math.min(...sizes)) / Math.max(...sizes));
    }

    if (metric > maxSelector.metric && elements.length < maxCountPerPage) {
      maxSelector = { selector, metric };
    }
  };

  for (let scroll = 0; scroll < scrolls; scroll += 1) {
    window.scrollTo(0, scroll * window.innerHeight);

    const grid = getGrid();

    grid.forEach(updateMaximumWithPoint);
  }

  restoreScroll();

  let out = Array.from(document.querySelectorAll(maxSelector.selector));

  const different = (x, i, a) => a.findIndex((e) => e === x) === i;
  // as long as we don't merge any two elements by substituing them for their parents,
  // we substitute.
  while (out.map((x) => x.parentElement).every(different)
    && out.forEach((x) => x.parentElement !== null)) {
    out = out.map((x) => x.parentElement ?? x);
  }

  return out;
}

/**
 * Returns a "scrape" result from the current page.
 * @returns {Array<Object>} *Curated* array of scraped information (with sparse rows removed)
 */
// Wrap the entire function in an IIFE (Immediately Invoked Function Expression)
// and attach it to the window object
(function (window) {
  /**
   * Returns a "scrape" result from the current page.
   * @returns {Array<Object>} *Curated* array of scraped information (with sparse rows removed)
   */
  window.scrape = function (selector = null) {
    /**
     * **crudeRecords** contains uncurated rundowns of "scrapable" elements
     * @type {Array<Object>}
     */
    const crudeRecords = (selector
      ? Array.from(document.querySelectorAll(selector))
      : scrapableHeuristics())
      .map((record) => ({
        ...Array.from(record.querySelectorAll('img'))
          .reduce((p, x, i) => {
            let url = null;
            if (x.srcset) {
              const urls = x.srcset.split(', ');
              [url] = urls[urls.length - 1].split(' ');
            }

            /**
               * Contains the largest elements from `srcset` - if `srcset` is not present, contains
               * URL from the `src` attribute
               *
               * If the `src` attribute contains a data url, imgUrl contains `undefined`.
               */
            let imgUrl;
            if (x.srcset) {
              imgUrl = url;
            } else if (x.src.indexOf('data:') === -1) {
              imgUrl = x.src;
            }

            return ({
              ...p,
              ...(imgUrl ? { [`img_${i}`]: imgUrl } : {}),
            });
          }, {}),
        ...record.innerText.split('\n')
          .reduce((p, x, i) => ({
            ...p,
            [`record_${String(i).padStart(4, '0')}`]: x.trim(),
          }), {}),
      }));

    return crudeRecords;
  };

  /**
   * TODO: Simplify.
   * Given an object with named lists of elements,
   *  groups the elements by their distance in the DOM tree.
   * @param {Object.<string, {selector: string, tag: string}>} lists The named lists of HTML elements.
   * @returns {Array.<Object.<string, string>>}
   */
  window.scrapeSchema = function(lists) {
    function omap(object, f, kf = (x) => x) {
        return Object.fromEntries(
            Object.entries(object)
                .map(([k, v]) => [kf(k), f(v)]),
        );
    }

    function ofilter(object, f) {
        return Object.fromEntries(
            Object.entries(object)
                .filter(([k, v]) => f(k, v)),
        );
    }
  
    function findAllElements(config) {
        if (!config.shadow || !config.selector.includes('>>')) {
            return Array.from(document.querySelectorAll(config.selector));
        }
    
        // For shadow DOM, we'll get all possible combinations
        const parts = config.selector.split('>>').map(s => s.trim());
        let currentElements = [document];
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const nextElements = [];
            
            for (const element of currentElements) {
                let targets;
                if (i === 0) {
                    // First selector is queried from document
                    targets = Array.from(element.querySelectorAll(part))
                        .filter(el => {
                            // Only include elements that either:
                            // 1. Have an open shadow root
                            // 2. Don't need shadow root (last part of selector)
                            if (i === parts.length - 1) return true;
                            const shadowRoot = el.shadowRoot;
                            return shadowRoot && shadowRoot.mode === 'open';
                        });
                } else {
                    // For subsequent selectors, only use elements with open shadow roots
                    const shadowRoot = element.shadowRoot;
                    if (!shadowRoot || shadowRoot.mode !== 'open') continue;
                    
                    targets = Array.from(shadowRoot.querySelectorAll(part));
                }
                nextElements.push(...targets);
            }
            
            if (nextElements.length === 0) return [];
            currentElements = nextElements;
        }
    
        return currentElements;
    }
  
    function getElementValue(element, attribute) {
        if (!element) return null;
    
        switch (attribute) {
            case 'href': {
                const relativeHref = element.getAttribute('href');
                return relativeHref ? new URL(relativeHref, window.location.origin).href : null;
            }
            case 'src': {
                const relativeSrc = element.getAttribute('src');
                return relativeSrc ? new URL(relativeSrc, window.location.origin).href : null;
            }
            case 'innerText':
                return element.innerText?.trim();
            case 'textContent':
                return element.textContent?.trim();
            default:
                return element.getAttribute(attribute) || element.innerText?.trim();
        }
    }

    // Get the seed key based on the maximum number of elements found
    function getSeedKey(listObj) {
        const maxLength = Math.max(...Object.values(
            omap(listObj, (x) => findAllElements(x).length)
        ));
        return Object.keys(
            ofilter(listObj, (_, v) => findAllElements(v).length === maxLength)
        )[0];
    }

    // Find minimal bounding elements
    function getMBEs(elements) {
      return elements.map((element) => {
          let candidate = element;
          const isUniqueChild = (e) => elements
              .filter((elem) => e.parentNode?.contains(elem))
              .length === 1;

          while (candidate && isUniqueChild(candidate)) {
              candidate = candidate.parentNode;
          }

          return candidate;
      });
    }

    // First try the MBE approach
    const seedName = getSeedKey(lists);
    const seedElements = findAllElements(lists[seedName]);
    const MBEs = getMBEs(seedElements);
    
    const mbeResults = MBEs.map((mbe) => omap(
        lists,
        (config) => {
            const elem = findAllElements(config)
                .find((elem) => mbe.contains(elem));
            
            return elem ? getElementValue(elem, config.attribute) : undefined;
        },
        (key) => key
    )) || [];

    // If MBE approach didn't find all elements, try independent scraping
    if (mbeResults.some(result => Object.values(result).some(v => v === undefined))) {
        // Fall back to independent scraping
        const results = [];
        const foundElements = new Map();

        // Find all elements for each selector
        Object.entries(lists).forEach(([key, config]) => {
            const elements = findAllElements(config);
            foundElements.set(key, elements);
        });

        // Create result objects for each found element
        foundElements.forEach((elements, key) => {
            elements.forEach((element, index) => {
                if (!results[index]) {
                    results[index] = {};
                }
                results[index][key] = getElementValue(element, lists[key].attribute);
            });
        });

        return results.filter(result => Object.keys(result).length > 0);
    }

    return mbeResults;
  };

  /**
 * Scrapes multiple lists of similar items based on a template item.
 * @param {Object} config - Configuration object
 * @param {string} config.listSelector - Selector for the list container(s)
 * @param {Object.<string, {selector: string, attribute?: string}>} config.fields - Fields to scrape
 * @param {number} [config.limit] - Maximum number of items to scrape per list (optional)
 * @param {boolean} [config.flexible=false] - Whether to use flexible matching for field selectors
 * @returns {Array.<Array.<Object>>} Array of arrays of scraped items, one sub-array per list
 */
  window.scrapeList = async function ({ listSelector, fields, limit = 10 }) {
    const scrapedData = [];

    // Helper function to query through Shadow DOM
    const queryShadowDOM = (rootElement, selector) => {
        // Split the selector by Shadow DOM delimiter
        const parts = selector.split('>>').map(part => part.trim());
        let currentElement = rootElement;

        // Traverse through each part of the selector
        for (let i = 0; i < parts.length; i++) {
            if (!currentElement) return null;

            // If we're at the document level (first part)
            if (!currentElement.querySelector && !currentElement.shadowRoot) {
                currentElement = document.querySelector(parts[i]);
                continue;
            }

            // Try to find element in regular DOM first
            let nextElement = currentElement.querySelector(parts[i]);

            // If not found, check shadow DOM
            if (!nextElement && currentElement.shadowRoot) {
                nextElement = currentElement.shadowRoot.querySelector(parts[i]);
            }

            // If still not found, try to find in shadow DOM of all child elements
            if (!nextElement) {
                const allChildren = Array.from(currentElement.children || []);
                for (const child of allChildren) {
                    if (child.shadowRoot) {
                        nextElement = child.shadowRoot.querySelector(parts[i]);
                        if (nextElement) break;
                    }
                }
            }

            currentElement = nextElement;
        }

        return currentElement;
    };

    // Helper function to query all elements through Shadow DOM
    const queryShadowDOMAll = (rootElement, selector) => {
        const parts = selector.split('>>').map(part => part.trim());
        let currentElements = [rootElement];
        
        for (const part of parts) {
            const nextElements = [];
            
            for (const element of currentElements) {
                // Check regular DOM
                if (element.querySelectorAll) {
                    nextElements.push(...element.querySelectorAll(part));
                }
                
                // Check shadow DOM
                if (element.shadowRoot) {
                    nextElements.push(...element.shadowRoot.querySelectorAll(part));
                }
                
                // Check shadow DOM of children
                const children = Array.from(element.children || []);
                for (const child of children) {
                    if (child.shadowRoot) {
                        nextElements.push(...child.shadowRoot.querySelectorAll(part));
                    }
                }
            }
            
            currentElements = nextElements;
        }
        
        return currentElements;
    };

    while (scrapedData.length < limit) {
        // Use our shadow DOM query function to get parent elements
        let parentElements = queryShadowDOMAll(document, listSelector);
        parentElements = Array.from(parentElements);

        // Handle the case when we don't find enough elements
        if (limit > 1 && parentElements.length <= 1) {
            const [containerSelector, ...rest] = listSelector.split('>>').map(s => s.trim());
            const container = queryShadowDOM(document, containerSelector);
            
            if (container) {
                const allChildren = Array.from(container.children || []);
                const firstMatch = queryShadowDOM(document, listSelector);
                
                if (firstMatch) {
                    const firstMatchClasses = Array.from(firstMatch.classList || []);
                    
                    parentElements = allChildren.filter(element => {
                        const elementClasses = Array.from(element.classList || []);
                        const commonClasses = firstMatchClasses.filter(cls => 
                            elementClasses.includes(cls));
                        return commonClasses.length >= Math.floor(firstMatchClasses.length * 0.7);
                    });
                }
            }
        }

        // Process each parent element
        for (const parent of parentElements) {
            if (scrapedData.length >= limit) break;
            const record = {};

            // Process each field using shadow DOM querying
            for (const [label, { selector, attribute }] of Object.entries(fields)) {
                // Use relative selector from parent
                const relativeSelector = selector.split('>>').slice(-1)[0];
                const fieldElement = queryShadowDOM(parent, relativeSelector);

                if (fieldElement) {
                    switch (attribute) {
                        case 'innerText':
                            record[label] = fieldElement.innerText?.trim() || '';
                            break;
                        case 'innerHTML':
                            record[label] = fieldElement.innerHTML?.trim() || '';
                            break;
                        case 'src':
                            const src = fieldElement.getAttribute('src');
                            record[label] = src ? new URL(src, window.location.origin).href : null;
                            break;
                        case 'href':
                            const href = fieldElement.getAttribute('href');
                            record[label] = href ? new URL(href, window.location.origin).href : null;
                            break;
                        default:
                            record[label] = fieldElement.getAttribute(attribute);
                    }
                }
            }
            
            if (Object.keys(record).length > 0) {
                scrapedData.push(record);
            }
        }

        if (parentElements.length === 0 || scrapedData.length >= parentElements.length) {
            break;
        }
    }
    
    return scrapedData;
};


  /**
 * Gets all children of the elements matching the listSelector,
 * returning their CSS selectors and innerText.
 * @param {string} listSelector - Selector for the list container(s)
 * @returns {Array.<Object>} Array of objects, each containing the CSS selector and innerText of the children
 */
  window.scrapeListAuto = function (listSelector) {
    const lists = Array.from(document.querySelectorAll(listSelector));

    const results = [];

    lists.forEach(list => {
      const children = Array.from(list.children);

      children.forEach(child => {
        const selectors = [];
        let element = child;

        // Traverse up to gather the CSS selector for the element
        while (element && element !== document) {
          let selector = element.nodeName.toLowerCase();
          if (element.id) {
            selector += `#${element.id}`;
            selectors.push(selector);
            break;
          } else {
            const className = element.className.trim().split(/\s+/).join('.');
            if (className) {
              selector += `.${className}`;
            }
            selectors.push(selector);
            element = element.parentElement;
          }
        }

        results.push({
          selector: selectors.reverse().join(' > '),
          innerText: child.innerText.trim()
        });
      });
    });

    return results;
  };

})(window);