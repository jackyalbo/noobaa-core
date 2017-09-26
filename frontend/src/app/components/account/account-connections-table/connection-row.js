import ko from 'knockout';
import { getCloudServiceMeta } from 'utils/ui-utils';
import { stringifyAmount } from 'utils/string-utils';

export default class ConnectionRowViewModel {
    constructor({ deleteGroup, onDelete }) {
        this.service = ko.observable();
        this.name = ko.observable();
        this.endpoint = ko.observable();
        this.identity = ko.observable();
        this.externalTargets = ko.observable();

        this.deleteButton = {
            subject: 'connection',
            id: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete,
            disabled: ko.observable(),
            tooltip: ko.observable()
        };
    }

    onConnection(connection) {
        const { name, service, endpoint, identity, usage } = connection;
        const hasExternalConnections = Boolean(usage.length);
        const serviceMeta = getCloudServiceMeta(service);
        const serviceInfo = {
            name: serviceMeta.icon,
            tooltip: service
        };
        const externalTargetsInfo = {
            text: stringifyAmount(serviceMeta.subject, usage.length, 'No'),
            tooltip: hasExternalConnections ? {
                text: usage.map(entity => entity.externalEntity),
                breakWords: true
            } : ''
        };
        const deleteToolTip = hasExternalConnections ?
            'Cannot delete currently used connection' :
            'Delete Connection';

        this.name(name);
        this.service(serviceInfo);
        this.endpoint(endpoint);
        this.identity(identity);
        this.externalTargets(externalTargetsInfo);
        this.deleteButton.id(name);
        this.deleteButton.disabled(hasExternalConnections);
        this.deleteButton.tooltip(deleteToolTip);
    }
}