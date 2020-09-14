(function(Drawio) {
  
    // Compatibility checks
    if(!String.prototype.startsWith) {
        String.prototype.startsWith = function(searchString, position) {
            position = position || 0;
            return this.substr(position, searchString.length) === searchString;
        };
    }
  
    if (!String.prototype.trim) {
        String.prototype.trim = function () {
            return this.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
        };
    }
    
    /**
     * Adapter for operations with the Readmine default editor
     * @param editor Redmine editor instance
     */
    function getRedmineEditorAdapter(editor) {
        return {
            getText    : function() { return $(editor.textarea).val(); },
            getCaretPos: function() { return $(editor.textarea).prop("selectionStart"); },
            setCaret   : function() {},
            selectText : function(start, end) {
                editor.textarea.focus();
                
                if(typeof(editor.textarea.selectionStart) != 'undefined') {
                    // Firefox/Chrome
                    editor.textarea.selectionStart = start;
                    editor.textarea.selectionEnd   = end;
                }
                else {
                    // IE
                    var range = document.selection.createRange();
                    
                    range.collapse(true);
                    range.moveStart("character", start);
                    range.moveEnd("character", end);
                    range.select();
                }
            },
            replaceSelected: function(newText, insert) {
                if(insert)
                    editor.encloseSelection(newText);
                else
                    editor.encloseSelection(newText, '', function(sel) { return ''; });
            }
        }
    }
    
    /**
     * Adapter for operations with the TinyMCE editor
     * @param editor TinyMCE editor instance
     */
    function getTinymceEditorAdapter(editor) {
        var startSel=0, endSel;

        return {
            getText    : function() { return editor.selection.getRng().startContainer.textContent; },
            getCaretPos: function() { return editor.selection.getRng().startOffset; },
            setCaret   : function(start) { startSel = endSel = start; },
            selectText : function(start, end) {
                startSel = start;
                endSel = end;
            },
            replaceSelected: function(newText, insert) { 
                var text = editor.selection.getRng().startContainer.textContent;
                
                if(insert || !endSel)
                    endSel = startSel

                editor.selection.getRng().startContainer.nodeValue = text.substring(0, startSel)+newText+text.substring(endSel);
            }
        }
    }
  
    /**
     * Find where starts the expectedMacro and returs its parameters.<br/>
     * It expects that the cursor is positioned inside the macro.<br/>
     * The macro header (the opening brackets, the macro name and the
     * optional parameters) will be selected, so inserting the new
     * macro header will overwite the old.
     * @param editor The editor where to find the macro
     * @param expectedMacro The expected macro name
     * @return An hash with the macro arguments, or {@code null} if not found.
     */
    function findMacro(editorAdapter, expectedMacro) {
        var text = editorAdapter.getText();
        var caretPos = editorAdapter.getCaretPos();
        var initialCaretPos = caretPos;
      
        // Move left to find macro start; the test on } is needed for not go too much ahead
        while(caretPos > 0 && !text.startsWith('{{', caretPos) && !text.startsWith('}}', caretPos))
            caretPos--;
          
        if(text.startsWith('{{', caretPos)) {
            // Start of a macro
            var macro = text.substring(caretPos);
            var match = macro.match('^\\{\\{'+expectedMacro+'(?:\\((.*)\\))?');
              
            if(match) {
                // Select macro text
                editorAdapter.selectText(caretPos, caretPos+match[0].length);
                  
                // Extracting macro arguments
                var params = {};
                var args   = [];
                  
                if(match[1]) {
                    var positionalParams = 0;
                    
                    args = match[1].split(',');
                     
                    for(var i=0; i<args.length; i++) {
                        var parts = args[i].split('=');
                        
                        if(parts.length == 2) // Named parameter
                            params[parts[0].trim()] = parts[1].trim();
                        else // Positional parameter
                            params['_P'+(++positionalParams)] = parts[0].trim();
                    }
                }
                
                return params;
            }
        }
        
        editorAdapter.setCaret(initialCaretPos);
        return null;
    }
  
    /**
     * Show dialog for editing macro parameters.
     * @param editorAdapter Adapter for editor interaction
     * @param macroName Name of macro to edit/insert
     */
    function openMacroDialog(editorAdapter, macroName) {
        var params = findMacro(editorAdapter, macroName);
      
        dlg.data('editor', editorAdapter)
           .data('macro', macroName)
           .data('params', params)
           .dialog('open');
    }
  
    /**
     * Add buttons to tinymce toolbar when editor is running.
     */
    function updateTinyMCEToolbar() {
        // See https://stackoverflow.com/questions/36411839/proper-way-of-modifying-toolbar-after-init-in-tinymce
        var editor = tinymce.activeEditor;
        
        if(editor) {
            editor.on('init', function() {
                var imgPath = Drawio.settings.redmineUrl+'plugin_assets/redmine_drawio/images';
                var bg = editor.theme.panel.find('toolbar buttongroup')[2];  // group with links/images/code/...
                
                editor.addButton('drawio_attach', {
                    title : Drawio.strings['drawio_attach_title'],
                    image : imgPath+'/jstb_drawio_attach.png',
                    onclick: function() {
                        openMacroDialog(getTinymceEditorAdapter(editor), 'drawio_attach');
                    }
                });
                bg.append(editor.buttons['drawio_attach']);
                
                if(Drawio.settings.DMSF) {
                    editor.addButton('drawio_dmsf', {
                        title: Drawio.strings['drawio_dmsf_title'  ],
                        image: imgPath+'/jstb_drawio_dmsf.png',
                        onclick: function() {
                            openMacroDialog(getTinymceEditorAdapter(editor), 'drawio_dmsf');
                        }
                    });
                    bg.append(editor.buttons['drawio_dmsf']);
                }
            });
        }
        else
            setTimeout(updateTinyMCEToolbar, 200);
    }
  
    // The dialog for macro editing must be defined only when the document is ready
    var dlg;
  
    $(function() {
        var dlgButtons = {};
        
        dlgButtons[Drawio.strings['drawio_btn_ok']] = function() {
            var editor    = dlg.data('editor');
            var macroName = dlg.data('macro');
            var diagName  = $('#drawio__P1').val();
            var diagType  = $('input[name=drawio_diagType]:checked').val();
            var size      = $('#drawio_size').val();
            
            if(diagName != '' && size.match(/^\d*$/)) {
                // Add/replace file extension
                diagName = diagName.replace(/^(.*?)(?:\.\w{3})?$/, '$1.'+diagType);
                
                var options = [diagName];
                
                if(/^\d+$/.test(size))
                    options.push('size='+size);
                
                if(options.length)
                    options = '('+options.join(',')+')';
                else
                    options = '';
                
                if(dlg.data('params')) 
                    // Edited macro: replace the old macro (with parameters) with the new text
                    editor.replaceSelected('{{'+macroName+options, false);
                else
                    // New macro
                    editor.replaceSelected('{{'+macroName+options+'}}\n', true);
                
                dlg.dialog('close');
            }
        };
        
        dlgButtons[Drawio.strings['drawio_btn_cancel']] = function() {
            dlg.dialog('close');
        };
        
        dlg = $('#dlg_redmine_drawio').dialog({
            autoOpen: false,
            width   : "auto",
            height  : "auto",
            modal   : true,
            open    : function(event, ui) {
                var params = dlg.data("params");
              
                if(params)
                    for(key in params)
                        $("#drawio_"+key).val(params[key]);
            },
            buttons : dlgButtons
        });
        
        // Make digits input accepting only digits
        $('#drawio_form input.digits').keyup(function(e) {
            if(/\D/g.test(this.value)) {
                this.value = this.value.replace(/\D/g, '');
            }
        });
        
        // Support for the redmine_wysiwyg_editor plugin
        if(typeof tinymce !== 'undefined') 
            updateTinyMCEToolbar();
    });
    
    // Initialize the jsToolBar object; called explicitly after the jsToolBar has been created
    Drawio.initToolbar = function() {
        jsToolBar.prototype.elements.drawio_attach = {
            type : 'button',
            after: 'img',
            title: Drawio.strings['drawio_attach_title'],
            fn   : { 
                wiki: function() { 
                    openMacroDialog(getRedmineEditorAdapter(this), 'drawio_attach');
                }
            }
        };
  
        if(Drawio.settings.DMSF)
            jsToolBar.prototype.elements.drawio_dmsf = {
                type : 'button',
                after: 'drawio_attach',
                title: Drawio.strings['drawio_dmsf_title'  ],
                fn   : { 
                    wiki : function() { 
                        openMacroDialog(getRedmineEditorAdapter(this), 'drawio_dmsf');
                    }
                }
            };
    
        // Add a space
        jsToolBar.prototype.elements.space_drawio = {
            type: 'space'
        }
    
        // Move back the help at the end
        var help = jsToolBar.prototype.elements.help;
        delete(jsToolBar.prototype.elements.help);
        jsToolBar.prototype.elements.help = help;
    }
})(Drawio);
