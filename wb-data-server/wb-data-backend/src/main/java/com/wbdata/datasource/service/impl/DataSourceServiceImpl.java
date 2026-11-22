package com.wbdata.datasource.service.impl;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.wbdata.common.crypto.SecretCryptoService;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.dto.TestConnectionRequest;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.mapper.DataSourceMapper;
import com.wbdata.datasource.plugin.DataSourceConnectionInfoFactory;
import com.wbdata.datasource.plugin.DataSourceConnectionPoolManager;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.ConnectionTestResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.Serializable;
import java.util.Collection;
import java.util.List;

@RequiredArgsConstructor
@Service
public class DataSourceServiceImpl extends ServiceImpl<DataSourceMapper, DataSource> implements DataSourceService {

    private final DataSourcePluginRegistry pluginRegistry;
    private final DataSourceConnectionPoolManager poolManager;
    private final DataSourceConnectionInfoFactory connectionInfoFactory;
    private final SecretCryptoService secretCryptoService;

    @Override
    public boolean save(DataSource entity) {
        if (entity == null) {
            return false;
        }
        DataSource toPersist = copyForPersistenceWithEncryptedPassword(entity);
        boolean saved = super.save(toPersist);
        if (toPersist.getId() != null) {
            entity.setId(toPersist.getId());
        }
        if (toPersist.getCreatedAt() != null) {
            entity.setCreatedAt(toPersist.getCreatedAt());
        }
        if (toPersist.getUpdatedAt() != null) {
            entity.setUpdatedAt(toPersist.getUpdatedAt());
        }
        return saved;
    }

    @Override
    public boolean updateById(DataSource entity) {
        if (entity == null) {
            return false;
        }
        return super.updateById(copyForPersistenceWithEncryptedPassword(entity));
    }

    @Override
    public DataSource getById(Serializable id) {
        return decryptEntity(super.getById(id));
    }

    @Override
    public DataSource getOne(Wrapper<DataSource> queryWrapper, boolean throwEx) {
        return decryptEntity(super.getOne(queryWrapper, throwEx));
    }

    @Override
    public List<DataSource> list(Wrapper<DataSource> queryWrapper) {
        return decryptEntities(super.list(queryWrapper));
    }

    @Override
    public List<DataSource> listByIds(Collection<? extends Serializable> idList) {
        return decryptEntities(super.listByIds(idList));
    }

    @Override
    public IPage<DataSource> getDataSourcePage(DataSourceSearchQuery query) {
        Page<DataSource> page = new Page<>(query.getPage(), query.getSize());
        IPage<DataSource> result = this.baseMapper.selectDataSourceList(page, query);
        if (result != null && result.getRecords() != null) {
            result.getRecords().forEach(this::decryptEntity);
        }
        return result;
    }

    @Override
    @Transactional
    public void updateStatus(Long id, String status) {
        DataSource ds = new DataSource();
        ds.setId(id);
        ds.setStatus(status);
        this.updateById(ds);
        poolManager.invalidate(id);
    }

    @Override
    public ConnectionTestResult testConnection(TestConnectionRequest request) {
        if (request.getType() == null || request.getType().isBlank()) {
            return ConnectionTestResult.failure("请选择数据源类型");
        }

        DataSource probe = new DataSource();
        probe.setType(request.getType());
        probe.setHost(request.getHost());
        probe.setPort(request.getPort());
        probe.setDatabaseName(request.getDatabaseName());
        probe.setUsername(request.getUsername());
        probe.setPassword(request.getPassword());
        probe.setConnectionParams(request.getConnectionParams());

        return pluginRegistry.getPlugin(request.getType())
                .map(plugin -> plugin.testConnectionDetailed(connectionInfoFactory.bypassingPool(probe)))
                .orElseGet(() -> ConnectionTestResult.failure("暂不支持的数据源类型: " + request.getType()));
    }

    @Override
    public ConnectionTestResult testConnection(Long id) {
        DataSource ds = this.getById(id);
        if (ds == null) {
            return ConnectionTestResult.failure("数据源不存在或已删除");
        }
        return pluginRegistry.getPlugin(ds.getType())
                .map(plugin -> plugin.testConnectionDetailed(connectionInfoFactory.bypassingPool(ds)))
                .orElseGet(() -> ConnectionTestResult.failure("暂不支持的数据源类型: " + ds.getType()));
    }

    private DataSource copyForPersistenceWithEncryptedPassword(DataSource source) {
        DataSource copy = copyForPersistence(source);
        String password = source.getPassword();
        if (password != null && !password.isEmpty()) {
            copy.setPassword(secretCryptoService.encrypt(password));
        }
        return copy;
    }

    private static DataSource copyForPersistence(DataSource source) {
        DataSource copy = new DataSource();
        copy.setId(source.getId());
        copy.setGroupId(source.getGroupId());
        copy.setName(source.getName());
        copy.setType(source.getType());
        copy.setDescription(source.getDescription());
        copy.setHost(source.getHost());
        copy.setPort(source.getPort());
        copy.setDatabaseName(source.getDatabaseName());
        copy.setUsername(source.getUsername());
        copy.setPassword(source.getPassword());
        copy.setConnectionParams(source.getConnectionParams());
        copy.setStatus(source.getStatus());
        copy.setOwner(source.getOwner());
        copy.setCreatedBy(source.getCreatedBy());
        copy.setUpdatedBy(source.getUpdatedBy());
        copy.setCreatedAt(source.getCreatedAt());
        copy.setUpdatedAt(source.getUpdatedAt());
        return copy;
    }

    private DataSource decryptEntity(DataSource entity) {
        if (entity != null && entity.getPassword() != null) {
            entity.setPassword(secretCryptoService.decryptOrPlaintext(entity.getPassword()));
        }
        return entity;
    }

    private List<DataSource> decryptEntities(List<DataSource> entities) {
        if (entities != null) {
            entities.forEach(this::decryptEntity);
        }
        return entities;
    }
}
