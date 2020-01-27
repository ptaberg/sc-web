const expertSystemIdList = ['nrel_system_identifier'];

class ExpertModeManager {

    constructor(sandbox) {
        this.sandbox = sandbox;
        this.languages = sandbox.getLanguages();
    }

    applyExpertMode(data, expertModeEnabled = SCWeb.core.ExpertModeEnabled) {
        return expertModeEnabled ? data : this.removeExpertData(data);
    }

    removeExpertData({triples, ...data}) {
        this.initTripleUtils(triples);
        return {
            triples: this.applyFilters(triples, data.keywords),
            ...data
        };
    }

    initTripleUtils(triples) {
        delete this.tripleUtils;
        this.tripleUtils = new TripleUtils();
        triples.forEach((triple) => this.tripleUtils.appendTriple(triple));
    }

    applyFilters(triples, keywords) {
        let filteredTriples = triples;
        const filters = [
            (triples) => this.removeTriplesWithNotCurrentLanguage(triples),
            (triples) => this.removeCurrentLanguageNode(triples),
            (triples) => this.removeExpertSystemIdTriples(triples),
            (triples) => this.transformKeyScElement(triples, keywords),
            (triples) => this.transformTextTranslation(triples, keywords),
            (triples) => this.transformContsCombitation(triples, keywords),
            (triples) => this.transformContsCombitation(triples, keywords, 'nrel_combination'),
        ];
        filters.forEach(filter => {
            this.initTripleUtils(filteredTriples);
            filteredTriples = filter(filteredTriples)
        });
        return filteredTriples
    }

    removeTriplesWithNotCurrentLanguage(triples) {
        let currentLanguageAddr = this.sandbox.getCurrentLanguage();
        let languageToRemoveList = this.languages.filter(lang => lang !== currentLanguageAddr);
        return this.removeTriplesByKeynodeList(languageToRemoveList, triples);
    }

    removeCurrentLanguageNode(triples) {
        let currentLanguageAddr = this.sandbox.getCurrentLanguage();
        const currentLanguage = this.languages.filter(lang => lang === currentLanguageAddr);
        return this.removeTriplesByKeynodeList(currentLanguage, triples, false);
    }

    removeExpertSystemIdTriples(triples) {
        return this.removeTriplesBySystemIdList(expertSystemIdList, triples)
    }

    removeTriplesBySystemIdList(systemIdList, triples, withChild = true) {
        const keynodeList = systemIdList.map((systemId) => this.getKeynode(systemId));
        return this.removeTriplesByKeynodeList(keynodeList, triples, withChild);
    }

    removeTriplesByKeynodeList(keynodeList, triples, withChild = true) {
        const expertSystemIdTriples = this.findExpertKeynodeTriples(keynodeList);
        const arcsToRemove = expertSystemIdTriples
            .map(triple => withChild ? [triple[1].addr, triple[2].addr] : [triple[1].addr]);
        const flatArray = [].concat.apply([], arcsToRemove);
        return this.removeArcs(flatArray, triples);
    }

    removeArcs(arcsToRemove, triples) {
        return triples.filter(triple => this.isNotTripleSystem(addr => arcsToRemove.includes(addr), triple))
    }

    findExpertKeynodeTriples(keynodeList) {
        let systemIdTriples = keynodeList
            .map(keynode => {
                const arcTriples = this.tripleUtils.find3_f_a_a(keynode, sc_type_arc_pos_const_perm, sc_type_arc_common);
                const linkTriples = this.tripleUtils.find3_f_a_a(keynode, sc_type_arc_pos_const_perm, sc_type_link);
                return [].concat(arcTriples, linkTriples);
            });
        return [].concat.apply([], systemIdTriples);
    }

    getKeynode(systemId) {
        return scKeynodes[systemId] || this.sandbox.getKeynode(systemId);
    }

    isNotTripleSystem(isAddrSystem, triple) {
        return !isAddrSystem(triple[0].addr) &&
            !isAddrSystem(triple[1].addr) &&
            !isAddrSystem(triple[2].addr);
    }

    /**
     * sourceNode
     * <- rrel_key_sc_element:
     translationNode
     (*
     <= nrel_sc_text_translation:
     preLinkNode
     (*
     -> linkNode;;
     *);;
     *);
     *
     * ===>
     * sourceNode
     * (*
     *  <- rrel_key_sc_element: linkNode;;
     * *)

     * @param triples
     * @returns filteredTriples
     */
    transformKeyScElement(triples, keywords) {
        const rrelKeyScElement = this.getKeynode("rrel_key_sc_element");
        const arcsToRemove = [];
        const newTriples = [];
        this.tripleUtils
            .find3_f_a_a(rrelKeyScElement, sc_type_arc_pos_const_perm, sc_type_arc_pos_const_perm)
            .forEach(triple => {
                const foundEdge = this.tripleUtils.getEdge(triple[2].addr, keywords[0].addr);
                if (!foundEdge) return;
                const [translationNode, edge, sourceNode] = foundEdge;
                const preLinkNode = this.findPreLinkNodeTriple(translationNode);
                if (preLinkNode) {
                    arcsToRemove.push(preLinkNode[1], preLinkNode[2], preLinkNode[3]);
                    const linkNodeTriple = this.findLinkNodeTriple(preLinkNode[0]);
                    if (linkNodeTriple) {
                        arcsToRemove.push(linkNodeTriple[1]);
                        newTriples.push([linkNodeTriple[2], edge, sourceNode]);
                    }
                }
            });

        const arcsToRemoveAddrs = arcsToRemove.map(({addr}) => addr);
        return this.removeArcs(arcsToRemoveAddrs, triples).concat(newTriples);
    }

    transformTextTranslation(triples, keywords) {
        const keyword = keywords[0];
        const prelinkNodeTriple = this.findPreLinkNodeTriple(keyword);

        if (!prelinkNodeTriple) return triples;
        const arcsToRemove = [];
        const newTriples = [];
        //arcsToRemove.push(prelinkNodeTriple[1], prelinkNodeTriple[3]);

        const linkNodeTriple = this.findLinkNodeTriple(prelinkNodeTriple[0]);
        if (linkNodeTriple) {
            arcsToRemove.push(linkNodeTriple[0], linkNodeTriple[1]);
            newTriples.push([linkNodeTriple[2], prelinkNodeTriple[1], keyword]);
        }
        const arcsToRemoveAddrs = arcsToRemove.map(({addr}) => addr);
        return this.removeArcs(arcsToRemoveAddrs, triples).concat(newTriples);
    }

    transformContsCombitation(triples, keywords, rel = 'nrel_using_constants') {
        const arcsToRemove = [];
        const combinationKeyNode = this.getKeynode(rel);
        const foundTriples = this.tripleUtils.find3_a_a_f(sc_type_node_tuple, sc_type_arc_pos_const_perm, keywords[0].addr);

        foundTriples.forEach(triple => {
            if (this.tripleUtils.find5_f_a_a_a_f(
                    triple[0].addr,
                    sc_type_arc_common,
                    sc_type_node,
                    sc_type_arc_pos_const_perm,
                    combinationKeyNode).length !== 0) {
                arcsToRemove.push(triple[1]);
            }
        });
        const arcsToRemoveAddrs = arcsToRemove.map(({addr}) => addr);
        return this.removeArcs(arcsToRemoveAddrs, triples);
    }

    findPreLinkNodeTriple(translationNode) {
        const nrelScTextTranslation = this.getKeynode("nrel_sc_text_translation");
        const triples = this.tripleUtils.find5_a_a_f_a_f(
            sc_type_node,
            sc_type_arc_common,
            translationNode.addr,
            sc_type_arc_pos_const_perm,
            nrelScTextTranslation);
        return Array.isArray(triples) && triples[0];
    }

    findLinkNodeTriple(preLinkNode) {
        const triples = this.tripleUtils.find3_f_a_a(preLinkNode.addr, sc_type_arc_pos_const_perm, sc_type_link);
        return triples.length && triples[0];
    }
}