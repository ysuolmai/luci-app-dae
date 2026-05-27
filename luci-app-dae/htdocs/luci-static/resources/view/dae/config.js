// SPDX-License-Identifier: Apache-2.0
'use strict';
'require fs';
'require ui';
'require view';

return view.extend({
    /* Active tab: 'form' | 'text' */
    _activeTab: 'form',
    /* Parsed DaeConfig; valid when form tab last rendered */
    _config: null,
    /* Reference to DaeParser module; set in render() */
    _parser: null,

    render: function() {
        var self = this;
        return Promise.all([
            fs.read_direct('/etc/dae/config.dae', 'text').catch(function() {
                return fs.read_direct('/etc/dae/example.dae', 'text').catch(function() {
                    return '';
                });
            }),
            L.require('view/dae/dae-parser')
        ]).then(function(results) {
            var content = results[0] || '';
            // L.require() already instantiates the class and returns the
            // singleton instance — don't `new` it again.
            self._parser = results[1];
            try {
                self._config = self._parser.parse(content);
                self._parser.ensureDefaultGroup(self._config);
            } catch(e) {
                self._config = self._parser.parse('');
                self._parser.ensureDefaultGroup(self._config);
                self._activeTab = 'text';
                ui.addNotification(null, E('p', _('Config parse error — opened in text mode: ') + e.message));
            }
            return self._loadNodesCache().then(function() {
                return self._buildUI(content);
            });
        }).catch(function(e) {
            ui.addNotification(null, E('p', e.message));
            return E('div', {}, _('Failed to load configuration.'));
        });
    },

    _buildUI: function(rawText) {
        var self = this;
        var container = E('div', { 'class': 'dae-config-container' });

        // ── Tab bar — use button styling so it actually looks like clickable buttons ──
        var tabBtn = function(id, label, active) {
            return E('button', {
                'id': 'tab-btn-' + id,
                'class': active ? 'btn cbi-button cbi-button-action' : 'btn cbi-button',
                'style': 'margin-right: 0.5em',
                'click': function() { self._switchTab(id); }
            }, label);
        };
        container.appendChild(E('div', { 'class': 'cbi-tabcontainer', 'style': 'margin-bottom:1em' }, [
            tabBtn('form',  _('Form'),       self._activeTab === 'form'),
            tabBtn('nodes', _('All Nodes'),  self._activeTab === 'nodes'),
            tabBtn('text',  _('Text'),       self._activeTab === 'text')
        ]));

        // ── Form pane ─────────────────────────────────────────────────────────
        var formPane = self._buildFormPane();
        formPane.id = 'pane-form';
        formPane.style.display = self._activeTab === 'form' ? '' : 'none';
        container.appendChild(formPane);

        // ── All Nodes pane (Task 11 fills this in) ────────────────────────────
        var nodesPane = self._buildNodesPane();
        nodesPane.id = 'pane-nodes';
        nodesPane.style.display = self._activeTab === 'nodes' ? '' : 'none';
        container.appendChild(nodesPane);

        // ── Text pane ─────────────────────────────────────────────────────────
        container.appendChild(E('div', {
            'id': 'pane-text',
            'style': self._activeTab === 'text' ? '' : 'display:none'
        }, [
            E('textarea', {
                'id': 'dae-raw-text',
                'class': 'cbi-input-textarea',
                'rows': '30',
                'style': 'width:100%;font-family:monospace;white-space:pre'
            }, [rawText])
        ]));

        return container;
    },

    _switchTab: function(tab) {
        var self = this;
        if (tab === self._activeTab) return;

        // Form → Text: serialize current form data
        if (self._activeTab === 'form' && tab === 'text') {
            try {
                var text = self._parser.serialize(self._getFormData());
                document.getElementById('dae-raw-text').value = text;
            } catch(e) {
                ui.addNotification(null, E('p', _('Failed to serialize form: ') + e.message));
                return;
            }
        }
        // Text → Form: parse text into config + refresh form
        if (self._activeTab === 'text' && tab === 'form') {
            var text = document.getElementById('dae-raw-text').value;
            try {
                self._config = self._parser.parse(text);
                self._parser.ensureDefaultGroup(self._config);
                self._refreshForm();
            } catch(e) {
                ui.addNotification(null, E('p', _('Config text has errors. Please fix before switching to form mode.')));
                return;
            }
        }
        // For nodes tab: re-render from cache (Task 11 implements _refreshNodes)
        if (tab === 'nodes') {
            self._refreshNodes();
        }

        self._activeTab = tab;
        ['form','nodes','text'].forEach(function(t) {
            document.getElementById('pane-' + t).style.display = (t === tab) ? '' : 'none';
            var btn = document.getElementById('tab-btn-' + t);
            btn.className = (t === tab) ? 'btn cbi-button cbi-button-action' : 'btn cbi-button';
        });
    },

    // ── Stubs implemented in Tasks 5–7 ──────────────────────────────────────
    _buildFormPane: function() {
        var self = this;
        var pane = E('div', { 'class': 'cbi-section' });
        pane.appendChild(self._buildSubscriptionSection());
        pane.appendChild(self._buildGroupSection());
        pane.appendChild(self._buildRoutingSection());
        pane.appendChild(self._buildDNSSection());
        pane.appendChild(self._buildGlobalSection());
        return pane;
    },

    _buildSubscriptionSection: function() {
        var self = this;
        var subs = (self._config || {}).subscription || {};
        var section = E('div', { 'class': 'cbi-section', 'id': 'section-subscription' });
        section.appendChild(E('h3', {}, _('Subscriptions')));
        var table = E('table', { 'class': 'table cbi-section-table', 'id': 'sub-table' }, [
            E('tr', { 'class': 'cbi-section-table-titles' }, [
                E('th', { 'class': 'cbi-section-table-cell', 'style': 'width:20%' }, _('Name')),
                E('th', { 'class': 'cbi-section-table-cell' }, _('Subscription URL')),
                E('th', { 'class': 'cbi-section-table-cell', 'style': 'width:80px' }, _('Action'))
            ])
        ]);
        Object.keys(subs).forEach(function(name) {
            table.appendChild(self._makeSubRow(name, subs[name]));
        });
        section.appendChild(table);
        section.appendChild(E('button', {
            'class': 'btn cbi-button cbi-button-add',
            'click': function() {
                document.getElementById('sub-table').appendChild(self._makeSubRow('', ''));
            }
        }, '+ ' + _('Add Subscription')));
        return section;
    },

    _makeSubRow: function(name, url) {
        var self = this;
        var row = E('tr', { 'class': 'cbi-section-table-row sub-row' }, [
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('input', {
                    'type': 'text', 'class': 'cbi-input-text sub-name',
                    'value': name, 'placeholder': _('e.g. my_sub'),
                    'pattern': '[\\w]+', 'title': _('Letters, digits, underscore only')
                })
            ]),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('input', {
                    'type': 'text', 'class': 'cbi-input-text sub-url',
                    'value': url, 'placeholder': 'https://...',
                    'style': 'width:100%'
                })
            ]),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('button', {
                    'class': 'btn cbi-button cbi-button-remove',
                    'click': function() { row.parentNode.removeChild(row); }
                }, _('Delete'))
            ])
        ]);
        return row;
    },

    _buildGroupSection: function() {
        var self = this;
        var section = E('div', { 'class': 'cbi-section', 'id': 'section-group' });
        section.appendChild(E('h3', {}, _('Proxy Groups')));

        var container = E('div', { 'id': 'group-cards' });
        var groups = (self._config && self._config.groups) || [];
        groups.forEach(function(g, idx) {
            container.appendChild(self._makeGroupCard(g, idx === 0));
        });
        section.appendChild(container);

        section.appendChild(E('button', {
            'class': 'btn cbi-button cbi-button-add',
            'click': function() {
                var groups = self._config.groups || [];
                var newName = 'group' + (groups.length + 1);
                var newGroup = {
                    name: newName,
                    filter: {
                        subscriptions: Object.keys(self._config.subscription || {}),
                        nodes: [],
                        excludeKeywords: ['ExpireAt'],
                        namePin: null
                    },
                    policy: 'min_moving_avg'
                };
                self._config.groups.push(newGroup);
                document.getElementById('group-cards').appendChild(self._makeGroupCard(newGroup, false));
            }
        }, '+ ' + _('Add Group')));

        return section;
    },

    _makeGroupCard: function(group, isFirst) {
        var self = this;
        var card = E('div', { 'class': 'cbi-section-node group-card', 'style': 'border:1px solid #ccc;padding:1em;margin-bottom:0.5em', 'data-group-name': group.name });

        // Header row: name + delete button
        var nameInput = E('input', {
            'type': 'text',
            'class': 'cbi-input-text group-name',
            'value': group.name,
            'style': 'width:14em',
            'pattern': '[\\w]+',
            'change': function(ev) {
                var oldName = card.getAttribute('data-group-name');
                var newName = ev.target.value;
                card.setAttribute('data-group-name', newName);
                self._onGroupRenamed(oldName, newName);
            }
        });

        var delBtn = E('button', {
            'class': 'btn cbi-button cbi-button-remove',
            'style': 'float:right',
            'disabled': isFirst ? '' : null,
            'click': function() {
                if (isFirst) return;
                self._onGroupDeleted(card.getAttribute('data-group-name'));
                card.parentNode.removeChild(card);
            }
        }, _('Delete Group'));

        card.appendChild(E('div', { 'style': 'margin-bottom:0.5em' }, [
            delBtn,
            E('label', { 'style': 'font-weight:bold;margin-right:0.5em' }, _('Group name:')),
            nameInput
        ]));

        // Subscriptions checkbox grid
        var subKeys = Object.keys((self._config && self._config.subscription) || {});
        var subBox = E('div', { 'class': 'group-subs', 'style': 'margin:0.5em 0' });
        subBox.appendChild(E('label', { 'style': 'display:block;font-weight:bold' }, _('Use Subscriptions:')));
        if (subKeys.length === 0) {
            subBox.appendChild(E('em', {}, _('(no subscriptions defined)')));
        } else {
            subKeys.forEach(function(sub) {
                var checked = (group.filter.subscriptions || []).indexOf(sub) !== -1;
                subBox.appendChild(E('label', { 'style': 'margin-right:1em' }, [
                    E('input', {
                        'type': 'checkbox',
                        'class': 'group-sub-cb',
                        'value': sub,
                        'checked': checked ? '' : null
                    }),
                    ' ' + sub
                ]));
            });
        }
        card.appendChild(subBox);

        // Manual nodes checkbox grid
        var nodeKeys = Object.keys((self._config && self._config.node) || {});
        if (nodeKeys.length > 0) {
            var nodeBox = E('div', { 'class': 'group-nodes', 'style': 'margin:0.5em 0' });
            nodeBox.appendChild(E('label', { 'style': 'display:block;font-weight:bold' }, _('Use Manual Nodes:')));
            nodeKeys.forEach(function(n) {
                var checked = (group.filter.nodes || []).indexOf(n) !== -1;
                nodeBox.appendChild(E('label', { 'style': 'margin-right:1em' }, [
                    E('input', {
                        'type': 'checkbox',
                        'class': 'group-node-cb',
                        'value': n,
                        'checked': checked ? '' : null
                    }),
                    ' ' + n
                ]));
            });
            card.appendChild(nodeBox);
        }

        // Exclude keywords input
        card.appendChild(E('div', { 'style': 'margin:0.5em 0' }, [
            E('label', { 'style': 'display:block;font-weight:bold' }, _('Exclude nodes whose name contains:')),
            E('input', {
                'type': 'text',
                'class': 'cbi-input-text group-exclude',
                'value': (group.filter.excludeKeywords || []).join(', '),
                'placeholder': 'ExpireAt, 流量, 剩余',
                'style': 'width:30em'
            }),
            E('br'),
            E('em', { 'style': 'font-size:0.85em;color:#666' }, _('(comma-separated)'))
        ]));

        // Policy dropdown
        var policySelect = E('select', { 'class': 'cbi-input-select group-policy' }, [
            E('option', { 'value': 'min_moving_avg', 'selected': (group.policy === 'min_moving_avg' && !group.filter.namePin) ? '' : null }, _('Auto (fastest)')),
            E('option', { 'value': 'random',         'selected': group.policy === 'random' ? '' : null }, _('Random')),
            E('option', { 'value': '__pin',          'selected': group.filter.namePin ? '' : null },     _('Pin to one node'))
        ]);
        policySelect.addEventListener('change', function() {
            var pinRow = card.querySelector('.group-pin-row');
            if (policySelect.value === '__pin') {
                if (!pinRow) {
                    pinRow = self._buildPinRow(group);
                    pinRow.classList.add('group-pin-row');
                    card.appendChild(pinRow);
                }
            } else if (pinRow) {
                pinRow.parentNode.removeChild(pinRow);
            }
        });
        card.appendChild(E('div', { 'style': 'margin:0.5em 0' }, [
            E('label', { 'style': 'display:block;font-weight:bold' }, _('Policy:')),
            policySelect
        ]));

        // Initial pin row if namePin is set
        if (group.filter.namePin) {
            var pinRow = self._buildPinRow(group);
            pinRow.classList.add('group-pin-row');
            card.appendChild(pinRow);
        }

        return card;
    },

    /**
     * Build the "pin to node" row — a dropdown of all known nodes
     * (from /tmp/dae-nodes-cache.json subscriptions + config.node manual).
     */
    _buildPinRow: function(group) {
        var self = this;
        var allNodes = self._allKnownNodeNames();
        var sel = E('select', { 'class': 'cbi-input-select group-pin' });
        if (allNodes.length === 0) {
            sel.appendChild(E('option', { 'value': '' }, _('(no nodes — fetch in All Nodes tab first)')));
        } else {
            sel.appendChild(E('option', { 'value': '' }, _('-- choose --')));
            allNodes.forEach(function(item) {
                sel.appendChild(E('option', {
                    'value': item.name,
                    'selected': group.filter.namePin === item.name ? '' : null
                }, item.name + ' (' + item.source + ')'));
            });
        }
        return E('div', { 'style': 'margin:0.5em 0' }, [
            E('label', { 'style': 'display:block;font-weight:bold' }, _('Pinned node:')),
            sel
        ]);
    },

    /**
     * Return [{name, source}] of every node known to UI:
     *  - subscription nodes from /tmp/dae-nodes-cache.json (if cache loaded)
     *  - manual nodes from this._config.node
     */
    _allKnownNodeNames: function() {
        var self = this;
        var out = [];
        var cache = self._nodesCache || {};
        var subs = cache.subscriptions || {};
        for (var subName in subs) {
            (subs[subName] || []).forEach(function(n) {
                out.push({ name: n.name, source: subName });
            });
        }
        Object.keys(self._config.node || {}).forEach(function(n) {
            out.push({ name: n, source: _('manual') });
        });
        return out;
    },

    /**
     * When a group is renamed, propagate to routing rules referencing the old name.
     */
    _onGroupRenamed: function(oldName, newName) {
        var self = this;
        var routing = self._config.routing || { rules: [], fallback: 'direct' };
        if (routing.fallback === oldName) routing.fallback = newName;
        (routing.rules || []).forEach(function(r) {
            if (r.action === oldName) r.action = newName;
        });
        // Also update the in-memory groups array
        var g = (self._config.groups || []).filter(function(g){ return g.name === oldName; })[0];
        if (g) g.name = newName;
        // Refresh the routing table dropdowns
        self._refreshRoutingActionOptions();
    },

    /**
     * When a group is deleted, point any routing rule referencing it to 'direct'.
     */
    _onGroupDeleted: function(name) {
        var self = this;
        self._config.groups = (self._config.groups || []).filter(function(g){ return g.name !== name; });
        var routing = self._config.routing || { rules: [], fallback: 'direct' };
        if (routing.fallback === name) routing.fallback = 'direct';
        (routing.rules || []).forEach(function(r) {
            if (r.action === name) r.action = 'direct';
        });
        self._refreshRoutingActionOptions();
        ui.addNotification(null, E('p', _('Group "%s" deleted. Routing rules referencing it have been reset to direct.').replace('%s', name)));
    },

    /**
     * Rebuild all <select.rule-action> options in the routing table to match
     * current self._config.groups.
     */
    _refreshRoutingActionOptions: function() {
        var self = this;
        var groupNames = (self._config.groups || []).map(function(g) { return g.name; });
        var allActions = ['direct', 'block'].concat(groupNames);
        document.querySelectorAll('.rule-action').forEach(function(sel) {
            var current = sel.value;
            sel.innerHTML = '';
            allActions.forEach(function(a) {
                sel.appendChild(E('option', { 'value': a, 'selected': a === current ? '' : null }, a));
            });
            // If current value no longer in options, add it (rare; deleted group still referenced)
            if (allActions.indexOf(current) === -1 && current) {
                sel.appendChild(E('option', { 'value': current, 'selected': '' }, current));
            }
        });
    },

    _buildRoutingSection: function() {
        var self = this;
        var routing = ((self._config || {}).routing) || { rules: [], fallback: 'direct' };
        // If no rules defined, seed the standard ones (private + cn IPs/domains → direct)
        if ((!routing.rules || routing.rules.length === 0)) {
            routing.rules = [
                { condType: 'dip',    condValue: 'geoip:private', action: 'direct' },
                { condType: 'dip',    condValue: 'geoip:cn',      action: 'direct' },
                { condType: 'domain', condValue: 'geosite:cn',    action: 'direct' }
            ];
            self._config.routing = routing;
        }
        var fallbackDefault = (self._config.groups && self._config.groups[0] && self._config.groups[0].name) || 'direct';
        var section = E('div', { 'class': 'cbi-section', 'id': 'section-routing' });
        section.appendChild(E('h3', {}, _('Routing Rules')));
        var table = E('table', { 'class': 'table cbi-section-table', 'id': 'routing-table' }, [
            E('tr', { 'class': 'cbi-section-table-titles' }, [
                E('th', { 'class': 'cbi-section-table-cell', 'style': 'width:15%' }, _('Condition Type')),
                E('th', { 'class': 'cbi-section-table-cell' },                       _('Condition Value')),
                E('th', { 'class': 'cbi-section-table-cell', 'style': 'width:18%' }, _('Action')),
                E('th', { 'class': 'cbi-section-table-cell', 'style': 'width:120px' }, _('Operation'))
            ])
        ]);
        (routing.rules || []).forEach(function(rule) {
            table.appendChild(self._makeRoutingRow(rule.condType, rule.condValue, rule.action));
        });
        // Fallback row (always last, not removable or sortable)
        var fallbackRow = E('tr', { 'class': 'cbi-section-table-row', 'id': 'routing-fallback-row' }, [
            E('td', { 'class': 'cbi-section-table-cell' }, E('strong', {}, _('Fallback'))),
            E('td', { 'class': 'cbi-section-table-cell' }, '—'),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                self._makeActionSelect('routing-fallback-action', routing.fallback || fallbackDefault)
            ]),
            E('td', { 'class': 'cbi-section-table-cell' }, '—')
        ]);
        table.appendChild(fallbackRow);
        section.appendChild(table);
        section.appendChild(E('button', {
            'class': 'btn cbi-button cbi-button-add',
            'click': function() {
                var fb = document.getElementById('routing-fallback-row');
                document.getElementById('routing-table').insertBefore(
                    self._makeRoutingRow('domain', '', 'direct'), fb);
            }
        }, '+ ' + _('Add Rule')));
        return section;
    },

    _buildDNSSection: function() {
        var self = this;
        var dns = ((self._config || {}).dns) || { upstream: {}, domestic: '', foreign: '', rawRouting: '' };
        var upstream = dns.upstream || {};
        var upstreamNames = Object.keys(upstream);
        var section = E('div', { 'class': 'cbi-section', 'id': 'section-dns' });
        section.appendChild(E('h3', {}, _('DNS')));
        section.appendChild(E('h4', {}, _('Upstream Servers')));
        var table = E('table', { 'class': 'table cbi-section-table', 'id': 'dns-upstream-table' }, [
            E('tr', { 'class': 'cbi-section-table-titles' }, [
                E('th', { 'class': 'cbi-section-table-cell', 'style': 'width:20%' }, _('Name')),
                E('th', { 'class': 'cbi-section-table-cell' }, _('URL')),
                E('th', { 'class': 'cbi-section-table-cell', 'style': 'width:80px' }, _('Action'))
            ])
        ]);
        upstreamNames.forEach(function(name) {
            table.appendChild(self._makeDNSUpstreamRow(name, upstream[name]));
        });
        section.appendChild(table);
        section.appendChild(E('button', {
            'class': 'btn cbi-button cbi-button-add',
            'click': function() {
                document.getElementById('dns-upstream-table').appendChild(
                    self._makeDNSUpstreamRow('', ''));
            }
        }, '+ ' + _('Add Upstream')));

        // DNS routing — simplified selectors or notice for custom routing
        if (!dns.rawRouting) {
            section.appendChild(E('h4', {}, _('DNS Routing')));
            section.appendChild(E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('Domestic DNS')),
                E('div', { 'class': 'cbi-value-field' }, [
                    self._makeDNSSelect('dns-domestic', dns.domestic, upstreamNames)
                ])
            ]));
            section.appendChild(E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('Foreign DNS')),
                E('div', { 'class': 'cbi-value-field' }, [
                    self._makeDNSSelect('dns-foreign', dns.foreign, upstreamNames)
                ])
            ]));
        } else {
            section.appendChild(E('p', { 'class': 'alert-message notice' },
                _('Custom DNS routing detected. Edit in text mode.')));
        }
        return section;
    },

    _buildGlobalSection: function() {
        var self = this;
        var global_ = (self._config || {}).global || {};
        var section = E('div', { 'class': 'cbi-section', 'id': 'section-global' });
        // Show heading + small hint that defaults are pre-applied.
        // Click toggles expand/collapse; default expanded so users see the defaults.
        var collapsed = false;
        var heading = E('h3', {}, _('Global Settings'));
        section.appendChild(E('div', {
            'style': 'cursor:pointer;user-select:none',
            'click': function() {
                var body = document.getElementById('global-section-body');
                collapsed = !collapsed;
                body.style.display = collapsed ? 'none' : '';
                heading.textContent = (collapsed ? '▶ ' : '▼ ') + _('Global Settings');
            }
        }, [heading]));
        // Set initial arrow
        heading.textContent = '▼ ' + _('Global Settings');
        var body = E('div', { 'id': 'global-section-body' });
        // Field names use dae's actual config syntax (underscores, not hyphens).
        // Defaults match dae example.dae conventions.
        var fields = [
            { key: 'log_level',                    label: _('Log Level'),                    type: 'select',   opts: ['error','warn','info','debug','trace'], def: 'info' },
            { key: 'wan_interface',                label: _('WAN Interface'),                type: 'text',     def: 'auto'   },
            { key: 'lan_interface',                label: _('LAN Interface (optional)'),     type: 'text',     def: ''       },
            { key: 'allow_insecure',               label: _('Allow Insecure'),               type: 'checkbox', def: 'false'  },
            { key: 'auto_config_kernel_parameter', label: _('Auto Config Kernel Parameter'), type: 'checkbox', def: 'true'   }
        ];
        fields.forEach(function(f) {
            var val = global_[f.key] !== undefined ? global_[f.key] : f.def;
            var input;
            if (f.type === 'select') {
                input = E('select', { 'id': 'global-' + f.key, 'class': 'cbi-input-select' });
                f.opts.forEach(function(o) {
                    input.appendChild(E('option', { 'value': o, 'selected': o === val ? '' : null }, o));
                });
            } else if (f.type === 'checkbox') {
                input = E('input', { 'type': 'checkbox', 'id': 'global-' + f.key,
                    'checked': val === 'true' ? '' : null });
            } else {
                input = E('input', { 'type': 'text', 'id': 'global-' + f.key,
                    'class': 'cbi-input-text', 'value': val });
            }
            body.appendChild(E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title', 'for': 'global-' + f.key }, f.label),
                E('div', { 'class': 'cbi-value-field' }, [input])
            ]));
        });
        section.appendChild(body);
        return section;
    },

    _makeRoutingRow: function(condType, condValue, action) {
        var self = this;
        var condTypes = ['domain', 'dip', 'sip', 'pname', 'l4proto', 'port'];
        var typeSelect = E('select', { 'class': 'cbi-input-select rule-cond-type' });
        condTypes.forEach(function(t) {
            typeSelect.appendChild(E('option', { 'value': t, 'selected': t === condType ? '' : null }, t));
        });
        var row = E('tr', { 'class': 'cbi-section-table-row routing-row' }, [
            E('td', { 'class': 'cbi-section-table-cell' }, [typeSelect]),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('input', {
                    'type': 'text', 'class': 'cbi-input-text rule-cond-value',
                    'value': condValue, 'placeholder': 'geosite:cn'
                })
            ]),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                self._makeActionSelect('', action)
            ]),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('button', {
                    'class': 'btn cbi-button', 'title': _('Move Up'),
                    'click': function() {
                        var prev = row.previousElementSibling;
                        if (prev && prev.classList.contains('routing-row'))
                            row.parentNode.insertBefore(row, prev);
                    }
                }, '↑'),
                ' ',
                E('button', {
                    'class': 'btn cbi-button', 'title': _('Move Down'),
                    'click': function() {
                        var next = row.nextElementSibling;
                        if (next && next.classList.contains('routing-row'))
                            row.parentNode.insertBefore(next, row);
                    }
                }, '↓'),
                ' ',
                E('button', {
                    'class': 'btn cbi-button cbi-button-remove',
                    'click': function() { row.parentNode.removeChild(row); }
                }, _('Delete'))
            ])
        ]);
        return row;
    },

    _makeActionSelect: function(id, selectedAction) {
        var self = this;
        var groupNames = (self._config && self._config.groups || []).map(function(g) { return g.name; });
        var options = ['direct', 'block'].concat(groupNames);
        if (selectedAction && options.indexOf(selectedAction) === -1) {
            // Preserve forward-compatibility for unknown actions
            options.push(selectedAction);
        }
        var attrs = { 'class': 'cbi-input-select rule-action' };
        if (id) attrs['id'] = id;
        var sel = E('select', attrs);
        options.forEach(function(opt) {
            sel.appendChild(E('option', {
                'value': opt,
                'selected': opt === selectedAction ? '' : null
            }, opt));
        });
        return sel;
    },
    _makeDNSUpstreamRow: function(name, url) {
        var row = E('tr', { 'class': 'cbi-section-table-row dns-upstream-row' }, [
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('input', { 'type': 'text', 'class': 'cbi-input-text dns-upstream-name',
                    'value': name, 'placeholder': 'alidns' })
            ]),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('input', { 'type': 'text', 'class': 'cbi-input-text dns-upstream-url',
                    'value': url, 'placeholder': 'udp://223.5.5.5:53', 'style': 'width:100%' })
            ]),
            E('td', { 'class': 'cbi-section-table-cell' }, [
                E('button', { 'class': 'btn cbi-button cbi-button-remove',
                    'click': function() { row.parentNode.removeChild(row); } }, _('Delete'))
            ])
        ]);
        return row;
    },

    _makeDNSSelect: function(id, selected, options) {
        var sel = E('select', { 'id': id, 'class': 'cbi-input-select' });
        sel.appendChild(E('option', { 'value': '' }, _('-- select --')));
        options.forEach(function(o) {
            sel.appendChild(E('option', { 'value': o, 'selected': o === selected ? '' : null }, o));
        });
        return sel;
    },

    _getFormData: function() {
        var self = this;
        var config = {
            global: {}, subscription: {}, node: {},
            groups: [],
            routing: { rules: [], fallback: 'direct' },
            dns: {
                upstream: {}, domestic: '', foreign: '',
                rawRouting: self._config ? (self._config.dns || {}).rawRouting || '' : ''
            },
            rawOther: self._config ? self._config.rawOther || '' : ''
        };

        // Global
        ['log_level','wan_interface','lan_interface','allow_insecure','auto_config_kernel_parameter']
            .forEach(function(key) {
                var el = document.getElementById('global-' + key);
                if (!el) return;
                if (el.type === 'checkbox') config.global[key] = el.checked ? 'true' : 'false';
                else if (el.value)          config.global[key] = el.value;
            });

        // Subscriptions
        document.querySelectorAll('#sub-table .sub-row').forEach(function(row) {
            var n = row.querySelector('.sub-name').value.trim();
            var u = row.querySelector('.sub-url').value.trim();
            if (n && u) config.subscription[n] = u;
        });

        // Manual nodes — read from in-memory self._config.node
        // (kept up-to-date by the All Nodes tab's add/delete operations)
        config.node = Object.assign({}, self._config.node || {});

        // Groups
        document.querySelectorAll('#group-cards .group-card').forEach(function(card) {
            var name = card.querySelector('.group-name').value.trim();
            if (!name) return;
            var subs = [];
            card.querySelectorAll('.group-sub-cb').forEach(function(cb) {
                if (cb.checked) subs.push(cb.value);
            });
            var nodes = [];
            card.querySelectorAll('.group-node-cb').forEach(function(cb) {
                if (cb.checked) nodes.push(cb.value);
            });
            var excludeStr = (card.querySelector('.group-exclude') || {}).value || '';
            var excludeKws = excludeStr.split(',').map(function(s){return s.trim();}).filter(Boolean);
            var policySelEl = card.querySelector('.group-policy');
            var policy = 'min_moving_avg';
            var namePin = null;
            if (policySelEl) {
                if (policySelEl.value === '__pin') {
                    var pinEl = card.querySelector('.group-pin');
                    if (pinEl) namePin = pinEl.value || null;
                } else {
                    policy = policySelEl.value;
                }
            }
            config.groups.push({
                name: name,
                filter: { subscriptions: subs, nodes: nodes, excludeKeywords: excludeKws, namePin: namePin },
                policy: namePin ? 'min_moving_avg' : policy
            });
        });

        // Routing rules
        document.querySelectorAll('#routing-table .routing-row').forEach(function(row) {
            var ct = row.querySelector('.rule-cond-type').value;
            var cv = row.querySelector('.rule-cond-value').value.trim();
            var ac = row.querySelector('.rule-action').value;
            if (cv) config.routing.rules.push({ condType: ct, condValue: cv, action: ac });
        });
        var fbEl = document.getElementById('routing-fallback-action');
        if (fbEl) config.routing.fallback = fbEl.value;

        // DNS upstream
        document.querySelectorAll('#dns-upstream-table .dns-upstream-row').forEach(function(row) {
            var n = row.querySelector('.dns-upstream-name').value.trim();
            var u = row.querySelector('.dns-upstream-url').value.trim();
            if (n && u) config.dns.upstream[n] = u;
        });
        if (!config.dns.rawRouting) {
            var domEl = document.getElementById('dns-domestic');
            var forEl = document.getElementById('dns-foreign');
            if (domEl) config.dns.domestic = domEl.value;
            if (forEl) config.dns.foreign  = forEl.value;
        }

        return config;
    },

    _refreshForm: function() {
        var self = this;
        var config = self._config || {};

        // Subscriptions
        var subTable = document.getElementById('sub-table');
        if (subTable) {
            subTable.querySelectorAll('.sub-row').forEach(function(r) { r.parentNode.removeChild(r); });
            Object.keys(config.subscription || {}).forEach(function(n) {
                subTable.appendChild(self._makeSubRow(n, config.subscription[n]));
            });
        }

        // Groups — full rebuild
        var groupContainer = document.getElementById('group-cards');
        if (groupContainer) {
            groupContainer.innerHTML = '';
            (config.groups || []).forEach(function(g, idx) {
                groupContainer.appendChild(self._makeGroupCard(g, idx === 0));
            });
        }

        // Routing rules
        var routingTable = document.getElementById('routing-table');
        if (routingTable) {
            routingTable.querySelectorAll('.routing-row').forEach(function(r) { r.parentNode.removeChild(r); });
            var fbRow = document.getElementById('routing-fallback-row');
            ((config.routing || {}).rules || []).forEach(function(rule) {
                routingTable.insertBefore(
                    self._makeRoutingRow(rule.condType, rule.condValue, rule.action), fbRow);
            });
            self._refreshRoutingActionOptions();
            var fbEl = document.getElementById('routing-fallback-action');
            if (fbEl && config.routing) fbEl.value = config.routing.fallback || 'direct';
        }

        // DNS upstream
        var dnsTable = document.getElementById('dns-upstream-table');
        if (dnsTable) {
            dnsTable.querySelectorAll('.dns-upstream-row').forEach(function(r) { r.parentNode.removeChild(r); });
            Object.keys((config.dns || {}).upstream || {}).forEach(function(n) {
                dnsTable.appendChild(self._makeDNSUpstreamRow(n, config.dns.upstream[n]));
            });
        }
        var domEl = document.getElementById('dns-domestic');
        var forEl = document.getElementById('dns-foreign');
        if (domEl && config.dns) domEl.value = config.dns.domestic || '';
        if (forEl && config.dns) forEl.value = config.dns.foreign  || '';

        // Global
        ['log_level','wan_interface','lan_interface','allow_insecure','auto_config_kernel_parameter']
            .forEach(function(key) {
                var el = document.getElementById('global-' + key);
                if (!el) return;
                var val = ((config.global || {})[key]) || '';
                if      (el.type === 'checkbox') el.checked = val === 'true';
                else if (el.tagName === 'SELECT') el.value  = val;
                else                             el.value   = val;
            });
    },

    _buildNodesPane: function() {
        var self = this;
        var pane = E('div', { 'class': 'cbi-section' });

        pane.appendChild(E('h3', {}, _('All Nodes')));

        // Toolbar: refresh + filter
        var refreshBtn = E('button', {
            'class': 'btn cbi-button cbi-button-action',
            'click': function() { self._refreshSubscriptionNodes(); }
        }, '🔄 ' + _('Refresh Subscription Nodes'));

        var filterSel = E('select', { 'class': 'cbi-input-select', 'id': 'nodes-filter', 'change': function() { self._renderNodesTable(); } }, [
            E('option', { 'value': '' }, _('All sources'))
        ]);

        pane.appendChild(E('div', { 'style': 'margin-bottom:0.5em' }, [
            refreshBtn,
            E('span', { 'style': 'margin-left:1em' }, _('Filter by source:') + ' '),
            filterSel
        ]));

        // Table container
        pane.appendChild(E('div', { 'id': 'nodes-table-container' }));

        // Manual add button
        pane.appendChild(E('button', {
            'class': 'btn cbi-button cbi-button-add',
            'style': 'margin-top:0.5em',
            'click': function() { self._addManualNode(); }
        }, '+ ' + _('Add Manual Node')));

        return pane;
    },

    _refreshNodes: function() {
        var self = this;
        self._loadNodesCache().then(function() {
            self._renderFilterOptions();
            self._renderNodesTable();
        });
    },

    _loadNodesCache: function() {
        var self = this;
        return fs.read_direct('/tmp/dae-nodes-cache.json', 'text')
            .then(function(text) {
                try { self._nodesCache = JSON.parse(text); }
                catch(e) { self._nodesCache = { subscriptions: {}, updated_at: 0 }; }
            })
            .catch(function() {
                self._nodesCache = { subscriptions: {}, updated_at: 0 };
            });
    },

    _renderFilterOptions: function() {
        var self = this;
        var sel = document.getElementById('nodes-filter');
        if (!sel) return;
        var current = sel.value;
        sel.innerHTML = '';
        sel.appendChild(E('option', { 'value': '' }, _('All sources')));
        var cache = self._nodesCache || { subscriptions: {} };
        Object.keys(cache.subscriptions || {}).forEach(function(s) {
            sel.appendChild(E('option', { 'value': s, 'selected': s === current ? '' : null }, s));
        });
        sel.appendChild(E('option', { 'value': '__manual', 'selected': current === '__manual' ? '' : null }, _('Manual')));
    },

    _renderNodesTable: function() {
        var self = this;
        var container = document.getElementById('nodes-table-container');
        if (!container) return;
        container.innerHTML = '';

        var cache = self._nodesCache || { subscriptions: {} };
        var filterEl = document.getElementById('nodes-filter');
        var filterVal = filterEl ? filterEl.value : '';

        var rows = [];

        // Subscription nodes
        Object.keys(cache.subscriptions || {}).forEach(function(subName) {
            if (filterVal && filterVal !== subName) return;
            (cache.subscriptions[subName] || []).forEach(function(n) {
                rows.push({
                    name: n.name, protocol: n.protocol, server: n.server, port: n.port,
                    source: subName, manual: false
                });
            });
        });
        // Manual nodes (parsed shallowly from config.node URIs — show URI as server:port)
        if (!filterVal || filterVal === '__manual') {
            Object.keys((self._config && self._config.node) || {}).forEach(function(n) {
                var uri = self._config.node[n];
                var scheme = (uri.match(/^([a-z0-9]+):\/\//) || [])[1] || '?';
                rows.push({
                    name: n, protocol: scheme, server: '(see URI)', port: '',
                    source: _('manual'), manual: true, uri: uri
                });
            });
        }

        var table = E('table', { 'class': 'table cbi-section-table' }, [
            E('tr', { 'class': 'cbi-section-table-titles' }, [
                E('th', { 'class': 'cbi-section-table-cell' }, _('Name')),
                E('th', { 'class': 'cbi-section-table-cell' }, _('Protocol')),
                E('th', { 'class': 'cbi-section-table-cell' }, _('Server:Port')),
                E('th', { 'class': 'cbi-section-table-cell' }, _('Source')),
                E('th', { 'class': 'cbi-section-table-cell' }, _('Action'))
            ])
        ]);

        if (rows.length === 0) {
            table.appendChild(E('tr', {}, [
                E('td', { 'colspan': 5, 'style': 'text-align:center;color:#999;padding:1em' },
                    _('No nodes yet. Click "Refresh Subscription Nodes" or "Add Manual Node".'))
            ]));
        } else {
            rows.forEach(function(r) {
                var row = E('tr', { 'class': 'cbi-section-table-row' }, [
                    E('td', { 'class': 'cbi-section-table-cell' }, r.name),
                    E('td', { 'class': 'cbi-section-table-cell' }, r.protocol),
                    E('td', { 'class': 'cbi-section-table-cell' }, r.server + (r.port ? ':' + r.port : '')),
                    E('td', { 'class': 'cbi-section-table-cell' }, r.source),
                    E('td', { 'class': 'cbi-section-table-cell' }, r.manual ? E('button', {
                        'class': 'btn cbi-button cbi-button-remove',
                        'click': function() {
                            delete self._config.node[r.name];
                            self._renderNodesTable();
                        }
                    }, _('Delete')) : '—')
                ]);
                table.appendChild(row);
            });
        }

        container.appendChild(table);
    },

    _addManualNode: function() {
        var self = this;
        var nameInput = E('input', { 'type': 'text', 'placeholder': 'myhomeproxy', 'class': 'cbi-input-text', 'style': 'width:12em' });
        var uriInput  = E('input', { 'type': 'text', 'placeholder': 'ss://... or vmess://...', 'class': 'cbi-input-text', 'style': 'width:30em' });
        ui.showModal(_('Add Manual Node'), [
            E('p', {}, _('Enter a name and the node URI:')),
            E('div', { 'style': 'margin:0.5em 0' }, [E('label', {}, _('Name:') + ' '), nameInput]),
            E('div', { 'style': 'margin:0.5em 0' }, [E('label', {}, _('URI:') + ' '),  uriInput]),
            E('div', { 'class': 'right' }, [
                E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
                ' ',
                E('button', {
                    'class': 'btn cbi-button cbi-button-action',
                    'click': function() {
                        var name = nameInput.value.trim();
                        var uri  = uriInput.value.trim();
                        if (!name.match(/^\w+$/)) { ui.addNotification(null, E('p', _('Name must be letters/digits/underscore only'))); return; }
                        if (!uri.match(/^[a-z0-9]+:\/\//))   { ui.addNotification(null, E('p', _('URI must start with scheme://'))); return; }
                        self._config.node = self._config.node || {};
                        self._config.node[name] = uri;
                        ui.hideModal();
                        self._renderNodesTable();
                    }
                }, _('Add'))
            ])
        ]);
    },

    _refreshSubscriptionNodes: function() {
        var self = this;
        ui.addNotification(null, E('p', _('Fetching subscriptions… this may take a few seconds.')));
        return fs.exec_direct('/usr/lib/luci-app-dae/list-nodes.sh', ['refresh-all'])
            .then(function() { return self._loadNodesCache(); })
            .then(function() {
                self._renderFilterOptions();
                self._renderNodesTable();
                ui.addNotification(null, E('p', _('Nodes refreshed.')));
            })
            .catch(function(e) {
                ui.addNotification(null, E('p', _('Refresh failed: ') + (e.message || e)));
            });
    },

    // ── Save ─────────────────────────────────────────────────────────────────
    handleSaveApply: function(ev, mode) {
        var self = this;
        var text;
        if (self._activeTab === 'form') {
            try { text = self._parser.serialize(self._getFormData()); }
            catch(e) {
                ui.addNotification(null, E('p', _('Failed to serialize form: ') + e.message));
                return Promise.resolve();
            }
        } else if (self._activeTab === 'text') {
            text = document.getElementById('dae-raw-text').value;
        } else {
            // Saving while on All Nodes tab: serialize from in-memory _config
            try { text = self._parser.serialize(self._config); }
            catch(e) {
                ui.addNotification(null, E('p', _('Failed to serialize: ') + e.message));
                return Promise.resolve();
            }
        }

        return fs.write('/etc/dae/config.dae', text, 384)
            .then(function() {
                return L.resolveDefault(fs.exec_direct('/etc/init.d/dae', ['hot_reload']), null);
            })
            .then(function() {
                ui.addNotification(null, E('p', _('Configuration saved and dae reloaded.')));
                // Fire-and-forget: refresh node cache in background
                L.resolveDefault(fs.exec_direct('/usr/lib/luci-app-dae/list-nodes.sh', ['refresh-all']), null)
                    .then(function() {
                        return self._loadNodesCache && self._loadNodesCache();
                    })
                    .catch(function() { /* silent */ });
            })
            .catch(function(e) {
                ui.addNotification(null, E('p', e.message));
            });
    }
});
