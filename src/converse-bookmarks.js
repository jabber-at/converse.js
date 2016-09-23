// Converse.js (A browser based XMPP chat client)
// http://conversejs.org
//
// Copyright (c) 2012-2016, Jan-Carel Brand <jc@opkode.com>
// Licensed under the Mozilla Public License (MPLv2)
//
/*global Backbone, define */

/* This is a Converse.js plugin which add support for bookmarks specified
 * in XEP-0048.
 */
(function (root, factory) {
    define("converse-bookmarks", [
            "jquery",
            "underscore",
            "moment_with_locales",
            "strophe",
            "utils",
            "converse-core",
            "converse-api",
            "converse-muc",
            "tpl!chatroom_bookmark_form"
        ],
        factory);
}(this, function ($, _, moment, strophe, utils, converse, converse_api, muc, chatroom_bookmark_form) {

    var __ = utils.__.bind(converse),
        Strophe = converse_api.env.Strophe,
        $iq = converse_api.env.$iq,
        b64_sha1 = converse_api.env.b64_sha1;

    // Add new HTML templates.
    converse.templates.chatroom_bookmark_form = chatroom_bookmark_form;

    converse_api.plugins.add('converse-bookmarks', {
        overrides: {
            // Overrides mentioned here will be picked up by converse.js's
            // plugin architecture they will replace existing methods on the
            // relevant objects or classes.
            //
            // New functions which don't exist yet can also be added.
            
            RoomsPanel: {
                /* TODO: show bookmarked rooms in the rooms panel */
            },

            ChatRoomView: {
                events: {
                    'click .toggle-bookmark': 'toggleBookmark'
                },

                initialize: function () {
                    this.__super__.initialize.apply(this, arguments);
                    this.model.on('change:bookmarked', this.onBookmarked, this);
                },

                render: function (options) {
                    this.__super__.render.apply(this, arguments);
                    var label_bookmark = _('Bookmark this room');
                    var button = '<a class="chatbox-btn toggle-bookmark icon-pushpin '+
                            (this.model.get('bookmarked') ? 'button-on"' : '"') +
                            'title="'+label_bookmark+'"></a>';
                    this.$el.find('.chat-head-chatroom .icon-wrench').before(button);
                    return this;
                },

                onBookmarked: function () {
                    this.$('.icon-pushpin').toggleClass('button-on');
                },

                renderBookmarkForm: function () {
                    var $body = this.$('.chatroom-body');
                    $body.children().addClass('hidden');
                    $body.append(
                        converse.templates.chatroom_bookmark_form({
                            heading: __('Bookmark this room'),
                            label_name: __('The name for this bookmark:'),
                            label_autojoin: __('Would you like this room to be automatically joined upon startup?'),
                            label_nick: __('What should your nickname for this room be?'),
                            default_nick: this.model.get('nick'),
                            label_submit: __('Save'),
                            label_cancel: __('Cancel')
                        }));
                    this.$('.chatroom-form').submit(this.addBookmark.bind(this));
                    this.$('.chatroom-form .button-cancel').on('click', this.cancelConfiguration.bind(this));
                },

                addBookmark: function (ev) {
                    ev.preventDefault();
                    converse.bookmarks.create({
                        'jid': this.model.get('jid'),
                        'autojoin': this.$el.find('.chatroom-form').find('input[name=autojoin]').val(),
                        'name':  this.$el.find('.chatroom-form').find('input[name=name]').val(),
                        'nick':  this.$el.find('.chatroom-form').find('input[name=nick]').val()
                    });
                    this.model.save('bookmarked', true);

                    var that = this,
                        $form = $(ev.target);
                    this.sendBookmarkStanza(
                        $form.find('input[name="name"]').val(),
                        $form.find('input[name="autojoin"]').prop('checked'),
                        $form.find('input[name="nick"]').val()
                    );
                    this.$el.find('div.chatroom-form-container').hide(
                        function () {
                            $(this).remove();
                            that.$('.chatroom-body').children().removeClass('hidden');
                        });
                },

                sendBookmarkStanza: function (name, autojoin, nick) {
                    name = name || converse.connection.jid;
                    var stanza = $iq({
                            'type': 'set',
                            'from': converse.connection.jid,
                        })
                        .c('pubsub', {'xmlns': Strophe.NS.PUBSUB})
                            .c('publish', {'node': 'storage:bookmarks'})
                                .c('item', {'id': 'current'})
                                    .c('storage', {'xmlns':'storage:bookmarks'})
                                        .c('conference', {
                                            'name': name,
                                            'autojoin': autojoin,
                                            'jid': this.model.get('jid'), 
                                        }).c('nick').t(nick).up()
                                        .up()
                                    .up()
                                .up()
                            .up()
                            .c('publish-options')
                                .c('x', {'xmlns': Strophe.NS.XFORM, 'type':'submit'})
                                    .c('field', {'var':'FORM_TYPE', 'type':'hidden'})
                                        .c('value').t('http://jabber.org/protocol/pubsub#publish-options').up().up()
                                    .c('field', {'var':'pubsub#persist_items'})
                                        .c('value').t('true').up().up()
                                    .c('field', {'var':'pubsub#access_model'})
                                        .c('value').t('whitelist');
                    converse.connection.sendIQ(stanza, null, this.onBookmarkError.bind(this));
                },

                onBookmarkError: function (iq) {
                    converse.log("Error while trying to add bookmark", "error");
                    converse.log(iq);
                    this.model.save('bookmarked', false);
                    window.alert(__("Sorry, something went wrong while trying to save your bookmark."));
                },

                toggleBookmark: function (ev) {
                    if (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                    }
                    if (!converse.bookmarks.get(this.model.get('id'))) {
                        this.renderBookmarkForm();
                    } else {
                        converse.bookmarks.remove({
                            'id': this.model.get('id')
                        });
                        this.$('.icon-pushpin').removeClass('button-on');
                    }
                }
            }
        },

        initialize: function () {
            /* The initialize function gets called as soon as the plugin is
             * loaded by converse.js's plugin machinery.
             */
            var converse = this.converse;

            converse.Bookmarks = Backbone.Collection.extend({
                
                onCachedBookmarksFetched: function () {
                    if (!window.sessionStorage.getItem(this.browserStorage.name)) {
                        // There aren't any cached bookmarks, so we query the
                        // XMPP server.
                        var stanza = $iq({
                            'from': converse.connection.jid,
                            'type': 'get',
                        }).c('pubsub', {'xmlns': Strophe.NS.PUBSUB})
                            .c('items', {'node': 'storage:bookmarks'});
                        converse.connection.sendIQ(
                            stanza,
                            this.onBookmarksReceived.bind(this),
                            this.onBookmarksReceivedError
                        );
                    } else {
                        this.models.each(this.markRoomAsBookmarked);
                    }
                },

                markRoomAsBookmarked: function (bookmark) {
                    var room = converse.chatboxes.get(bookmark.get('jid'));
                    if (!_.isUndefined(room)) {
                        room.save('bookmarked', true);
                    }
                },

                onBookmarksReceived: function (iq) {
                    var bookmarks = $(iq).find(
                        'items[node="storage:bookmarks"] item[id="current"] storage conference'
                    );
                    _.each(bookmarks, function (bookmark) {
                        this.markRoomAsBookmarked(this.create({
                            'jid': bookmark.getAttribute('jid'),
                            'name': bookmark.getAttribute('name'),
                            'autojoin': bookmark.getAttribute('autojoin'),
                            'nick': bookmark.querySelector('nick').textContent
                        }));
                    }.bind(this));
                },

                onBookmarksReceivedError: function (iq) {
                    converse.log('Error while fetching bookmarks');
                    converse.log(iq);
                }
            });

            converse.initBookmarks = function () {
                converse.bookmarks = new converse.Bookmarks();
                var id = b64_sha1('converse.room-bookmarks');
                converse.bookmarks.id = id;
                converse.bookmarks.browserStorage = new Backbone.BrowserStorage[converse.storage](id);
                converse.bookmarks.fetch({
                    'add': true,
                    'success': converse.bookmarks.onCachedBookmarksFetched.bind(converse.bookmarks),
                    'error':  converse.bookmarks.onCachedBookmarksFetched.bind(converse.bookmarks)

                });
            };
            converse.on('connected', converse.initBookmarks);
            converse.on('reconnected', converse.initBookmarks);
        }
    });
}));
