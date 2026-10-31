"use strict";

describe("Achmage Edition", function () {
	var win, doc;
	
	before(async function () {
		win = await loadZoteroPane();
		doc = win.document;
	});
	
	after(function () {
		win.close();
	});
	
	it("should show the wordmark in the tab bar and open About from it", async function () {
		var button = doc.getElementById('zotero-tb-achmage');
		assert.ok(button);
		assert.include(win.getComputedStyle(button).listStyleImage, 'achmage/wordmark.svg');
		
		var promise = waitForWindow('chrome://zotero/content/about.xhtml');
		button.doCommand();
		var about = await promise;
		var text = about.document.getElementById('achmage-edition-text').textContent;
		assert.equal(text, Zotero.ftl.formatValueSync('achmage-edition-about'));
		assert.equal(
			about.document.getElementById('achmage-edition-link').getAttribute('data-href'),
			'https://github.com/laguna821/zotero/releases'
		);
		about.close();
	});
});
