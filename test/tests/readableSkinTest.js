"use strict";

// The test runner turns the skin off, so that other tests cover the stock UI
describe("Readable skin", function () {
	var win, doc, zp;
	
	before(async function () {
		win = await loadZoteroPane();
		doc = win.document;
		zp = win.ZoteroPane;
		await activateZoteroPane();
	});
	
	afterEach(function () {
		Zotero.Prefs.set('readableSkin', false);
	});
	
	after(function () {
		win.close();
	});
	
	
	function getFieldNames() {
		var itemBox = doc.getElementById('zotero-editpane-info-box');
		return [...itemBox.querySelectorAll('.meta-label[fieldname]')]
			.map(x => x.getAttribute('fieldname'));
	}
	
	async function createArticle() {
		var item = new Zotero.Item('journalArticle');
		item.setField('title', 'Title');
		item.setField('publicationTitle', 'Journal');
		item.setField('date', '2025');
		await item.saveTx();
		await zp.selectItem(item.id);
		return item;
	}
	
	async function waitFor(cb) {
		var result = await waitForCallback(cb, 10, 3);
		if (result instanceof Error) {
			throw result;
		}
	}
	
	
	it("should mark the window while it's on", function () {
		Zotero.Prefs.set('readableSkin', true);
		assert.isTrue(doc.documentElement.hasAttribute('readableSkin'));
		assert.isTrue(doc.getElementById('zotero-pane').hasAttribute('readableSkin'));
		assert.notEqual(
			win.getComputedStyle(doc.documentElement).getPropertyValue('--readable-accent-tint'),
			''
		);
		
		Zotero.Prefs.set('readableSkin', false);
		assert.isFalse(doc.documentElement.hasAttribute('readableSkin'));
		assert.equal(
			win.getComputedStyle(doc.documentElement).getPropertyValue('--readable-accent-tint'),
			''
		);
	});
	
	
	describe("Info pane", function () {
		it("should fold empty fields behind a row that shows them", async function () {
			Zotero.Prefs.set('readableSkin', true);
			var item = await createArticle();
			
			await waitFor(() => doc.getElementById('empty-fields-label'));
			var fields = getFieldNames();
			assert.includeMembers(fields, ['title', 'publicationTitle', 'date', 'dateAdded']);
			assert.notInclude(fields, 'volume');
			
			var toggle = doc.getElementById('empty-fields-label');
			// All fields except the three with values and the abstract, which has its own section
			var numEmpty = Zotero.ItemFields.getItemTypeFields(item.itemTypeID).length - 4;
			await doc.l10n.translateElements([toggle]);
			assert.include(toggle.textContent, String(numEmpty));
			// Placed before Date Added
			assert.equal(
				toggle.closest('.meta-row').nextElementSibling.querySelector('.meta-label')
					.getAttribute('fieldname'),
				'dateAdded'
			);
			
			toggle.click();
			await waitFor(() => getFieldNames().includes('volume'));
			
			// Fold them again
			doc.getElementById('empty-fields-label').click();
			await waitFor(() => !getFieldNames().includes('volume'));
		});
		
		it("should fold empty fields again for another item", async function () {
			Zotero.Prefs.set('readableSkin', true);
			await createArticle();
			await waitFor(() => doc.getElementById('empty-fields-label'));
			doc.getElementById('empty-fields-label').click();
			await waitFor(() => getFieldNames().includes('volume'));
			
			await createArticle();
			await waitFor(() => !getFieldNames().includes('volume'));
		});
		
		it("should show all fields of an item with only a title", async function () {
			Zotero.Prefs.set('readableSkin', true);
			var item = new Zotero.Item('book');
			item.setField('title', 'Only a title');
			await item.saveTx();
			await zp.selectItem(item.id);
			
			await waitFor(() => getFieldNames().includes('publisher'));
			assert.isNull(doc.getElementById('empty-fields-label'));
		});
		
		it("should show empty fields without the skin", async function () {
			await createArticle();
			await waitFor(() => getFieldNames().includes('volume'));
			assert.isNull(doc.getElementById('empty-fields-label'));
		});
		
		it("should update when the skin is turned on or off", async function () {
			await createArticle();
			await waitFor(() => getFieldNames().includes('volume'));
			
			Zotero.Prefs.set('readableSkin', true);
			await waitFor(() => !getFieldNames().includes('volume'));
			
			Zotero.Prefs.set('readableSkin', false);
			await waitFor(() => getFieldNames().includes('volume'));
		});
	});
	
	
	describe("View menu", function () {
		it("should toggle the skin", async function () {
			var popup = doc.getElementById('menu_viewPopup');
			var menuitem = doc.getElementById('view-menuitem-readable-skin');
			popup.dispatchEvent(new win.Event('popupshowing'));
			assert.isFalse(menuitem.hasAttribute('checked'));
			
			// The command event is dispatched asynchronously
			menuitem.doCommand();
			await waitFor(() => Zotero.Prefs.get('readableSkin'));
			popup.dispatchEvent(new win.Event('popupshowing'));
			assert.equal(menuitem.getAttribute('checked'), 'true');
			
			menuitem.doCommand();
			await waitFor(() => !Zotero.Prefs.get('readableSkin'));
		});
	});
});
