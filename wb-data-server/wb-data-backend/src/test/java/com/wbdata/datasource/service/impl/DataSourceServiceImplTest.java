package com.wbdata.datasource.service.impl;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.common.crypto.SecretCryptoService;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.mapper.DataSourceMapper;
import com.wbdata.datasource.plugin.DataSourceConnectionInfoFactory;
import com.wbdata.datasource.plugin.DataSourceConnectionPoolManager;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DataSourceServiceImplTest {

    private DataSourceMapper mapper;
    private SecretCryptoService cryptoService;
    private DataSourceServiceImpl service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(DataSourceMapper.class);
        cryptoService = new SecretCryptoService("test-master-key", null);
        service = new DataSourceServiceImpl(
                Mockito.mock(DataSourcePluginRegistry.class),
                Mockito.mock(DataSourceConnectionPoolManager.class),
                Mockito.mock(DataSourceConnectionInfoFactory.class),
                cryptoService
        );
        ReflectionTestUtils.setField(service, "baseMapper", mapper);
    }

    @Test
    void save_encryptsPasswordWithoutMutatingCallerAndPropagatesId() {
        when(mapper.insert(any(DataSource.class))).thenAnswer(invocation -> {
            DataSource inserted = invocation.getArgument(0);
            inserted.setId(42L);
            return 1;
        });

        DataSource ds = new DataSource();
        ds.setGroupId(1L);
        ds.setName("mysql-prod");
        ds.setType("MYSQL");
        ds.setHost("db.internal");
        ds.setPort(3306);
        ds.setPassword("PlainPass!123");
        ds.setConnectionParams(Map.of("useSSL", "true"));

        boolean saved = service.save(ds);

        assertThat(saved).isTrue();
        assertThat(ds.getId()).isEqualTo(42L);
        assertThat(ds.getPassword()).isEqualTo("PlainPass!123");

        ArgumentCaptor<DataSource> captor = ArgumentCaptor.forClass(DataSource.class);
        verify(mapper).insert(captor.capture());
        DataSource persisted = captor.getValue();
        assertThat(persisted.getPassword()).startsWith(SecretCryptoService.PREFIX_V1);
        assertThat(persisted.getPassword()).isNotEqualTo("PlainPass!123");
        assertThat(cryptoService.decrypt(persisted.getPassword())).isEqualTo("PlainPass!123");
        assertThat(persisted.getConnectionParams()).containsEntry("useSSL", "true");
    }

    @Test
    void updateById_encryptsProvidedPasswordAndPreservesNullPassword() {
        when(mapper.updateById(any(DataSource.class))).thenReturn(1);

        DataSource withNewPassword = new DataSource();
        withNewPassword.setId(7L);
        withNewPassword.setPassword("Rotated!456");

        assertThat(service.updateById(withNewPassword)).isTrue();
        assertThat(withNewPassword.getPassword()).isEqualTo("Rotated!456");

        ArgumentCaptor<DataSource> captor = ArgumentCaptor.forClass(DataSource.class);
        verify(mapper).updateById(captor.capture());
        String persistedCipher = captor.getValue().getPassword();
        assertThat(persistedCipher).startsWith(SecretCryptoService.PREFIX_V1);
        assertThat(cryptoService.decrypt(persistedCipher)).isEqualTo("Rotated!456");

        Mockito.reset(mapper);
        when(mapper.updateById(any(DataSource.class))).thenReturn(1);

        DataSource withoutPassword = new DataSource();
        withoutPassword.setId(7L);
        withoutPassword.setName("updated-name");
        withoutPassword.setPassword(null);

        assertThat(service.updateById(withoutPassword)).isTrue();
        verify(mapper).updateById(captor.capture());
        assertThat(captor.getValue().getPassword()).isNull();
    }

    @Test
    void getById_decryptsCiphertextAndAllowsLegacyPlaintext() {
        DataSource encryptedRow = new DataSource();
        encryptedRow.setId(1L);
        encryptedRow.setPassword(cryptoService.encrypt("secret-v1"));
        when(mapper.selectById(1L)).thenReturn(encryptedRow);

        DataSource legacyRow = new DataSource();
        legacyRow.setId(2L);
        legacyRow.setPassword("legacy-plain");
        when(mapper.selectById(2L)).thenReturn(legacyRow);

        assertThat(service.getById(1L).getPassword()).isEqualTo("secret-v1");
        assertThat(service.getById(2L).getPassword()).isEqualTo("legacy-plain");
    }

    @Test
    void readCollectionsAndPage_decryptRecordsTransparently() {
        DataSource row1 = new DataSource();
        row1.setId(1L);
        row1.setPassword(cryptoService.encrypt("page-secret-1"));
        DataSource row2 = new DataSource();
        row2.setId(2L);
        row2.setPassword("legacy-plain-2");

        Page<DataSource> mockPage = new Page<>(1, 10);
        mockPage.setRecords(List.of(row1, row2));
        when(mapper.selectDataSourceList(any(), any(DataSourceSearchQuery.class))).thenReturn(mockPage);

        IPage<DataSource> page = service.getDataSourcePage(new DataSourceSearchQuery());
        assertThat(page.getRecords())
                .extracting(DataSource::getPassword)
                .containsExactly("page-secret-1", "legacy-plain-2");

        DataSource listRow = new DataSource();
        listRow.setId(3L);
        listRow.setPassword(cryptoService.encrypt("list-secret-3"));
        when(mapper.selectList(any(Wrapper.class))).thenReturn(List.of(listRow));

        assertThat(service.list()).extracting(DataSource::getPassword).containsExactly("list-secret-3");
    }
}
